/* ==========================================================================
   ScoreQR — Self-contained pure-JS ISO/IEC 18004 QR Code SVG Generator
   Zero external dependencies, offline/PWA-ready.
   Supports UTF-8 Byte mode, Error Correction Level M, Versions 1–10 (up to 213 bytes).
   Exposes: window.ScoreQR = { encode(text), renderSvg(text, opts) }
   ========================================================================== */
(function (global) {
  'use strict';

  // Version 1..10 tables for ECC Level M: [totalCodewords, ecCodewordsPerBlock, numBlocksGroup1, dataCwGroup1, numBlocksGroup2, dataCwGroup2]
  const VER_M = [
    null,
    [26,  10, 1, 16, 0, 0],   // V1  (21x21, max 14B)
    [44,  16, 1, 28, 0, 0],   // V2  (25x25, max 26B)
    [70,  26, 1, 44, 0, 0],   // V3  (29x29, max 42B)
    [100, 18, 2, 32, 0, 0],   // V4  (33x33, max 62B)
    [134, 24, 2, 43, 0, 0],   // V5  (37x37, max 84B)
    [172, 16, 4, 27, 0, 0],   // V6  (41x41, max 106B)
    [196, 18, 4, 31, 0, 0],   // V7  (45x45, max 122B)
    [242, 22, 2, 38, 2, 39],  // V8  (49x49, max 152B)
    [292, 22, 3, 36, 2, 37],  // V9  (53x53, max 180B)
    [346, 26, 4, 43, 1, 44],  // V10 (57x57, max 213B)
  ];

  // Alignment pattern centers for Versions 1..10
  const ALIGN = [
    null,
    [],
    [6, 18],
    [6, 22],
    [6, 26],
    [6, 30],
    [6, 34],
    [6, 22, 38],
    [6, 24, 42],
    [6, 26, 46],
    [6, 28, 50],
  ];

  // Precomputed 15-bit format info for ECC Level M (00) and masks 0..7 (with BCH + XOR 0x5412)
  const FORMAT_M = [
    0x5412, 0x5125, 0x5e7c, 0x5b4b, 0x45f9, 0x40ce, 0x4f97, 0x4aa0
  ];

  // Version info 18-bit BCH for Versions 7..10
  const VER_INFO = {
    7:  0x07c94,
    8:  0x085bc,
    9:  0x09a99,
    10: 0x0a4d3,
  };

  // GF(256) exp/log tables with primitive polynomial 0x11d
  const EXP = new Uint8Array(512);
  const LOG = new Uint8Array(256);
  (function initGF() {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x;
      LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();

  function gfMul(a, b) {
    if (a === 0 || b === 0) return 0;
    return EXP[LOG[a] + LOG[b]];
  }

  function rsGenerator(ecLen) {
    let poly = [1];
    for (let i = 0; i < ecLen; i++) {
      const next = new Array(poly.length + 1).fill(0);
      const factor = EXP[i];
      for (let j = 0; j < poly.length; j++) {
        next[j] ^= poly[j];
        next[j + 1] ^= gfMul(poly[j], factor);
      }
      poly = next;
    }
    return poly;
  }

  function rsEncode(data, ecLen) {
    const gen = rsGenerator(ecLen);
    const out = new Uint8Array(ecLen);
    for (let i = 0; i < data.length; i++) {
      const factor = data[i] ^ out[0];
      for (let j = 0; j < ecLen - 1; j++) {
        out[j] = out[j + 1] ^ gfMul(gen[j + 1], factor);
      }
      out[ecLen - 1] = gfMul(gen[ecLen], factor);
    }
    return out;
  }

  function utf8Bytes(str) {
    if (typeof TextEncoder !== 'undefined') return Array.from(new TextEncoder().encode(str));
    const out = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c < 0x80) out.push(c);
      else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      else out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
    return out;
  }

  function pickVersion(byteLen) {
    for (let v = 1; v <= 10; v++) {
      const spec = VER_M[v];
      const totalDataCw = spec[2] * spec[3] + spec[4] * spec[5];
      const lenBits = v <= 9 ? 8 : 16;
      const capBytes = Math.floor((totalDataCw * 8 - 4 - lenBits) / 8);
      if (byteLen <= capBytes) return v;
    }
    throw new Error('QR payload too long (max 213 UTF-8 bytes)');
  }

  function buildCodewords(bytes, version) {
    const spec = VER_M[version];
    const ecPerBlock = spec[1];
    const totalDataCw = spec[2] * spec[3] + spec[4] * spec[5];
    const bits = [];
    const pushBits = (val, n) => {
      for (let i = n - 1; i >= 0; i--) bits.push((val >>> i) & 1);
    };

    // Byte mode indicator (0100) + length + payload
    pushBits(0b0100, 4);
    pushBits(bytes.length, version <= 9 ? 8 : 16);
    for (let i = 0; i < bytes.length; i++) pushBits(bytes[i], 8);

    // Terminator (up to 4 zero bits)
    const maxBits = totalDataCw * 8;
    const term = Math.min(4, maxBits - bits.length);
    for (let i = 0; i < term; i++) bits.push(0);
    while (bits.length % 8 !== 0) bits.push(0);

    // Pack to bytes + pad alternating 0xEC, 0x11
    const data = [];
    for (let i = 0; i < bits.length; i += 8) {
      let b = 0;
      for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
      data.push(b);
    }
    let padToggle = 0;
    while (data.length < totalDataCw) {
      data.push(padToggle ? 0x11 : 0xec);
      padToggle ^= 1;
    }

    // Split into blocks and compute RS ECC
    const blocks = [];
    const ecBlocks = [];
    let offset = 0;
    for (let g = 0; g < 2; g++) {
      const count = g === 0 ? spec[2] : spec[4];
      const len = g === 0 ? spec[3] : spec[5];
      for (let i = 0; i < count; i++) {
        const blk = data.slice(offset, offset + len);
        offset += len;
        blocks.push(blk);
        ecBlocks.push(rsEncode(blk, ecPerBlock));
      }
    }

    // Interleave data then ECC codewords
    const finalCw = [];
    const maxDataLen = Math.max(spec[3], spec[5]);
    for (let i = 0; i < maxDataLen; i++) {
      for (let b = 0; b < blocks.length; b++) {
        if (i < blocks[b].length) finalCw.push(blocks[b][i]);
      }
    }
    for (let i = 0; i < ecPerBlock; i++) {
      for (let b = 0; b < ecBlocks.length; b++) {
        finalCw.push(ecBlocks[b][i]);
      }
    }
    return finalCw;
  }

  function createMatrix(version) {
    const size = version * 4 + 17;
    const mod = Array.from({ length: size }, () => new Uint8Array(size));
    const isFunc = Array.from({ length: size }, () => new Uint8Array(size));

    const setFunc = (r, c, dark) => {
      if (r < 0 || c < 0 || r >= size || c >= size) return;
      mod[r][c] = dark ? 1 : 0;
      isFunc[r][c] = 1;
    };

    // Finder patterns + separators
    const drawFinder = (r0, c0) => {
      for (let dr = -1; dr <= 7; dr++) {
        for (let dc = -1; dc <= 7; dc++) {
          const r = r0 + dr, c = c0 + dc;
          if (r < 0 || c < 0 || r >= size || c >= size) continue;
          const on = (dr >= 0 && dr <= 6 && dc >= 0 && dc <= 6) &&
            (dr === 0 || dr === 6 || dc === 0 || dc === 6 || (dr >= 2 && dr <= 4 && dc >= 2 && dc <= 4));
          setFunc(r, c, on);
        }
      }
    };
    drawFinder(0, 0);
    drawFinder(0, size - 7);
    drawFinder(size - 7, 0);

    // Alignment patterns
    const centers = ALIGN[version];
    for (let i = 0; i < centers.length; i++) {
      for (let j = 0; j < centers.length; j++) {
        const cr = centers[i], cc = centers[j];
        if ((cr <= 8 && cc <= 8) || (cr <= 8 && cc >= size - 9) || (cr >= size - 9 && cc <= 8)) continue;
        for (let dr = -2; dr <= 2; dr++) {
          for (let dc = -2; dc <= 2; dc++) {
            const on = Math.max(Math.abs(dr), Math.abs(dc)) !== 1;
            setFunc(cr + dr, cc + dc, on);
          }
        }
      }
    }

    // Timing patterns
    for (let i = 8; i < size - 8; i++) {
      if (!isFunc[6][i]) setFunc(6, i, i % 2 === 0);
      if (!isFunc[i][6]) setFunc(i, 6, i % 2 === 0);
    }

    // Reserve format info areas + dark module
    for (let i = 0; i <= 8; i++) {
      if (!isFunc[8][i]) setFunc(8, i, false);
      if (!isFunc[i][8]) setFunc(i, 8, false);
    }
    for (let i = size - 8; i < size; i++) {
      if (!isFunc[8][i]) setFunc(8, i, false);
      if (!isFunc[i][8]) setFunc(i, 8, false);
    }
    setFunc(size - 8, 8, true);

    // Version info for V7..10
    if (version >= 7) {
      const vi = VER_INFO[version];
      for (let i = 0; i < 18; i++) {
        const bit = ((vi >>> i) & 1) === 1;
        const a = Math.floor(i / 3), b = size - 11 + (i % 3);
        setFunc(a, b, bit);
        setFunc(b, a, bit);
      }
    }

    return { size, mod, isFunc };
  }

  function placeData(matrix, codewords) {
    const { size, mod, isFunc } = matrix;
    let bitIdx = 0;
    const totalBits = codewords.length * 8;
    let upward = true;
    for (let right = size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5;
      for (let vert = 0; vert < size; vert++) {
        const r = upward ? size - 1 - vert : vert;
        for (let dx = 0; dx < 2; dx++) {
          const c = right - dx;
          if (isFunc[r][c]) continue;
          let dark = 0;
          if (bitIdx < totalBits) {
            dark = (codewords[bitIdx >>> 3] >>> (7 - (bitIdx & 7))) & 1;
            bitIdx++;
          }
          mod[r][c] = dark;
        }
      }
      upward = !upward;
    }
  }

  function maskBit(mask, r, c) {
    switch (mask) {
      case 0: return (r + c) % 2 === 0;
      case 1: return r % 2 === 0;
      case 2: return c % 3 === 0;
      case 3: return (r + c) % 3 === 0;
      case 4: return (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0;
      case 5: return ((r * c) % 2) + ((r * c) % 3) === 0;
      case 6: return (((r * c) % 2) + ((r * c) % 3)) % 2 === 0;
      case 7: return (((r + c) % 2) + ((r * c) % 3)) % 2 === 0;
      default: return false;
    }
  }

  function writeFormat(mod, size, mask) {
    const bits = FORMAT_M[mask];
    const getB = (i) => (bits >>> i) & 1;
    // Around top-left finder
    for (let i = 0; i <= 5; i++) mod[i][8] = getB(i);
    mod[7][8] = getB(6);
    mod[8][8] = getB(7);
    mod[8][7] = getB(8);
    for (let i = 9; i < 15; i++) mod[8][14 - i] = getB(i);
    // Split bottom-left & top-right
    for (let i = 0; i < 8; i++) mod[8][size - 1 - i] = getB(i);
    for (let i = 8; i < 15; i++) mod[size - 15 + i][8] = getB(i);
    mod[size - 8][8] = 1;
  }

  function penaltyScore(mod, size) {
    let score = 0;
    // Rule 1: 5+ same-color runs
    for (let r = 0; r < size; r++) {
      let run = 1;
      for (let c = 1; c < size; c++) {
        if (mod[r][c] === mod[r][c - 1]) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
    for (let c = 0; c < size; c++) {
      let run = 1;
      for (let r = 1; r < size; r++) {
        if (mod[r][c] === mod[r - 1][c]) {
          run++;
          if (run === 5) score += 3;
          else if (run > 5) score += 1;
        } else run = 1;
      }
    }
    // Rule 2: 2x2 blocks
    for (let r = 0; r < size - 1; r++) {
      for (let c = 0; c < size - 1; c++) {
        const v = mod[r][c];
        if (v === mod[r][c + 1] && v === mod[r + 1][c] && v === mod[r + 1][c + 1]) score += 3;
      }
    }
    // Rule 4: dark ratio balance
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (mod[r][c]) dark++;
    const pct = (dark * 100) / (size * size);
    score += Math.floor(Math.abs(pct - 50) / 5) * 10;
    return score;
  }

  function encode(text) {
    const bytes = utf8Bytes(String(text || ''));
    const version = pickVersion(bytes.length);
    const codewords = buildCodewords(bytes, version);
    const base = createMatrix(version);
    placeData(base, codewords);

    let bestMask = 0;
    let bestScore = Infinity;
    let bestMod = null;

    for (let m = 0; m < 8; m++) {
      const copy = base.mod.map((row) => Uint8Array.from(row));
      for (let r = 0; r < base.size; r++) {
        for (let c = 0; c < base.size; c++) {
          if (!base.isFunc[r][c] && maskBit(m, r, c)) copy[r][c] ^= 1;
        }
      }
      writeFormat(copy, base.size, m);
      const s = penaltyScore(copy, base.size);
      if (s < bestScore) {
        bestScore = s;
        bestMask = m;
        bestMod = copy;
      }
    }

    return { version, size: base.size, mask: bestMask, modules: bestMod };
  }

  function renderSvg(text, opts) {
    const o = opts || {};
    const quiet = typeof o.quiet === 'number' ? o.quiet : 4;
    const fg = o.fg || '#0c0d10';
    const bg = o.bg || '#ffffff';
    const label = o.ariaLabel || 'Friend QR code';
    const qr = encode(text);
    const dim = qr.size + quiet * 2;
    let d = '';
    for (let r = 0; r < qr.size; r++) {
      const row = qr.modules[r];
      for (let c = 0; c < qr.size; c++) {
        if (row[c]) d += `M${c + quiet},${r + quiet}h1v1h-1z`;
      }
    }
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${dim} ${dim}" shape-rendering="crispEdges" role="img" aria-label="${String(label).replace(/"/g, '&quot;')}"><rect width="${dim}" height="${dim}" fill="${bg}"/><path d="${d}" fill="${fg}"/></svg>`;
  }

  global.ScoreQR = { encode, renderSvg };
})(typeof window !== 'undefined' ? window : globalThis);
