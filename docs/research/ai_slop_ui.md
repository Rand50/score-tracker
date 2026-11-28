# AI slop in apps and UI: research for TallyIt

Researched 28 November 2026 for Rand Wilkinson / TallyIt (https://tallyit.fun/game_tracker.html). This note answers three questions, then gives a practical checklist. It does not audit or change the app.

Method: web research only, from designer and developer writing, Hacker News, Reddit, and articles published or updated in 2025–2026, plus canonical design sources. Every claim below comes from a page that was actually opened. Quotes and figures are taken from those pages, not reconstructed. Tells are ranked by how often they showed up across those sources, not by a formal corpus count. One tell alone proves nothing; people recognize the look when several arrive together.

---

## 1. What is "AI slop" in apps and UI?

**Crisp definition.** In general use, AI slop is low-quality digital content produced, usually in volume, by generative AI, and shipped with little or no human review. Merriam-Webster, which named *slop* its 2025 Word of the Year, defines it as “digital content of low quality that is produced usually in quantity by means of artificial intelligence.” In apps and UI, the useful definition is narrower: **an interface that looks finished and competent, but interchangeable, because nobody chose its look or finished its edge cases.** Ralabs puts it this way: “AI design slop is interface work that is competent and interchangeable. Nothing is broken, and nothing was chosen.” Strict Themes describes the same thing as “output that was generated and never looked at,” with a look “you can spot from across the room.”

A January 2026 academic article summarized on Wikipedia (Kommers et al.) says AI slop has “so far resisted formal definition,” but names three “prototypical properties”: superficial competence, asymmetric effort, and mass producibility. That triad fits vibe-coded apps well. The screen often looks polished. The work to make it was cheap and fast. And the same defaults can be stamped out at scale, so the result does not belong to this product.

**Where the term comes from.** “Slop” for low-grade AI material showed up around the release of AI image generators in 2022, as in-group slang on 4chan, Hacker News, and YouTube, according to Wikipedia’s entry on AI slop. Other labels were tried first (“AI garbage,” “AI pollution,” “AI-generated dross”). In May 2024 the term moved into the mainstream. On 7 May 2024, the X account @deepfates wrote that “slop” was becoming “the term for unwanted AI generated content,” the way “spam” became the term for unwanted email. The next day, Simon Willison endorsed that framing and added a useful distinction: “Not all promotional content is spam, and not all AI-generated content is slop. But if it’s mindlessly generated and thrust upon someone who didn’t ask for it, slop is the perfect term.” Scientific American (9 November 2025) credits the same sequence. Willison later condensed it to “AI-generated content that is both unrequested and unreviewed.”

By late 2025 the word was established enough that Merriam-Webster made *slop* its Word of the Year (announced 15 December 2025), and the American Dialect Society did the same on 9 January 2026, recognizing “widespread use for low-quality, high-quantity content, most typically produced by generative AI.” In UI writing, “AI slop,” “design slop,” “vibe-coded,” and “the Claude look” are now used almost interchangeably for the same set of defaults.

**The mechanism, which matters more than the insult.** Anthropic’s Applied AI team, in a 12 November 2025 post, named the cause *distributional convergence*. During sampling, models predict the next token from statistical patterns in training data. “Safe design choices—those that work universally and offend no one—dominate web training data. Without direction, Claude samples from this high-probability center.” The defaults they name are Inter, purple gradients on white, and little motion. Business Insider (7 July 2026) cites University of Washington researcher Donghoon Shin: vibe-coded products converge toward “a single, statistically average aesthetic.” Carnegie Mellon’s Sauvik Das called this “regression to the mean.” Paul Bakaus (Impeccable) called the result an “algorithmic Uniqlo or Ikea”: not necessarily bad, just not unique. Ralabs’s useful corollary: “An average of every interface ever built is not a style. It’s the absence of one.” Adjectives like “modern,” “clean,” and “minimal” do not fix it, because those words already live inside the average.

Two further mechanics show up again and again:

- **The tells are defaults, not choices.** Strict Themes: a coding agent with no design to follow still has to pick a color, a size, and a radius. “It picks the likeliest one.” “Nobody decided the button should glow. Nothing said it should not.”
- **Each element is decided alone.** That is how one page ends up with seven greys, or how Leave / Log / Delete controls drift from game to game. Consistency is a system. Next-token generation is not.

A related point, made by Anthropic and by regards.design: banning one default is not enough. When Anthropic told Claude to avoid Inter, it moved to the next common face, Space Grotesk. “A list of things to avoid can’t give a site a direction; a decision can.”

---

## 2. The most common tells

Ranked by how often they appeared in the sources opened for this note. For each tell: what it looks like, why generation produces it, and why people read it as low quality.

### 1. Purple-to-blue (indigo / violet / pink) gradients, often on white, plus gradient text

**What it looks like.** Indigo, violet, or pink blended across the hero, the heading, the primary button, or all three. Gradient text via `background-clip`. Sometimes a violet wash behind a screenshot. Impeccable lists “Purple Gradients Everywhere” as a canonical example. Anthropic names “purple gradients on white backgrounds” as the unguided default. deslopmydesign.com calls “Purple-to-blue gradient on white” one of “the greatest hits of AI slop.”

**Why it happens.** Tailwind and component-library demos saturated the training data with indigo and violet accents (often `bg-indigo-500` and nearby palettes). Asked for a “clean, modern” page, the model emits the most common accent it has seen, then “makes it pop” with a gradient. It is a high-probability token sequence, not a brand decision.

**Why it reads as low quality.** It has become a recognisable fingerprint. Jason Lemkin (SaaStr) wrote that “you can literally spot a Claude-generated site from across the room,” and that the look became “a tell for ‘this was built by non-technical founders with AI.’” Visitors have seen the gradient before they have read a word of the product.

### 2. Inter (or Geist, Space Grotesk, Poppins, system-ui) for everything, and the unmodified shadcn / Tailwind look

**What it looks like.** One neutral sans for headings, body, buttons, and labels, at a few safe sizes. Slate or zinc neutrals, a default radius (often around 8px or `rounded-2xl`), default primary buttons, default card borders and shadows. Lemkin adds Lucide icons as part of the same fingerprint. Impeccable’s example is literally titled “Inter Everywhere.” After Inter was widely banned in prompts, models often moved to Geist or Space Grotesk, which then became the new default (Anthropic’s test; regards.design; Adrian Krebs).

**Why it happens.** Inter is extremely common on the web and in starter kits, including shadcn/ui. The model copies the most frequent stack in its training data and in the repo it is editing. Component libraries are not the problem; shipping their defaults without retheming is. As regards.design puts it, the site looks vibe-coded “when nobody chose its look, so the defaults show.”

**Why it reads as low quality.** Typography is one of the fastest tells. A product with no typographic voice feels like a template. Agent Design: “If you did not choose a typeface, the agent chose Inter or system-ui for you.” People do not need to name the font to feel that the page could belong to anyone.

### 3. The template layout: centered hero, three identical feature cards, cards inside cards

**What it looks like.** A centred hero with two buttons, sometimes a logo strip, then three same-shaped feature cards, often with an icon in a tinted tile above the title, then a CTA band. Inside the app, the cousin is “cardocalypse”: a bordered box inside a shadowed box, “five layers of cards” around the same content (Impeccable). Strict Themes lists “cards inside cards” and “centered everything” as two of its ten tells. Reddit’s r/UI_Design thread independently named “uniform spacing and equal-weight cards,” “the same stock layout (hero, three feature cards, CTA band),” and “icon-topped feature card.”

**Why it happens.** That floor plan is the median SaaS landing page in the training data. Centering “needs no decision about alignment” (Strict Themes). A card is the easiest way to make a group of content feel “designed,” so the model wraps every group, at every level. Agent Design calls “hero → three features → pricing → footer” “the LLM floor plan.”

**Why it reads as low quality.** The page does not respond to its own content. Nothing is emphasised because everything is boxed the same way. Ralabs: generated layouts “reach for containers instead, because a border is easier to add than a decision about what matters.” The accumulated effect is that “nothing is emphasised, because everything is.” Visitors can swap another logo onto the hero and nothing would have to change (Agent Design’s “swap test”).

### 4. Generic, interchangeable copy

**What it looks like.** Headlines and buttons that could sell anything: “Supercharge your workflow,” “Unlock your potential,” “Seamless,” “The all-in-one platform for modern teams,” “Build faster,” “Get started.” Pill badges that say “New: AI-powered” and add no information. Forced contrast (“Not a tool. A platform.”). Em dashes stacked in a paragraph. Typed arrow glyphs on every button. Impeccable also flags “redundant UX writing”: four bits of text explaining the same field.

**Why it happens.** Marketing-page language is over-represented in training data. Vague adjectives were rewarded because they offend no one and fit any product. The model is completing a pitch, not describing this app.

**Why it reads as low quality.** If the headline and subhead could be pasted onto a competitor, they are not doing any work. illos.dev’s test: hide everything except those two lines; if you still cannot tell a friend what the product does, fix the words before the spacing. Apple’s iOS Human Interface Guidelines (2013) already advised, “Think like a newspaper editor, and watch out for redundant or unnecessary words.” People also now treat stacked em dashes and trailing arrows as a writing tell, in the same way they treat the purple gradient as a visual one (RJ Patinio, citing Impeccable).

### 5. Emoji as icons, generic line icons in tinted squares, and oversized icon tiles

**What it looks like.** A rocket for “fast,” a lock for “secure,” sparkles in a logo or a “New” badge. Lucide or another thin-line set, dropped into a rounded coloured square above every card title. Impeccable’s “Massive Icons”: “Oversized icon tiles make decoration more prominent than the feature it introduces.” Sidebar or nav with emoji icons (Adrian Krebs).

**Why it happens.** An emoji needs no import and no icon set. When the brief says “a modern feature grid,” the training data is full of icon-topped cards. The model is decorating a slot, not illustrating the product.

**Why it reads as low quality.** Icons that could sit on any SaaS site signal that nobody looked at this product. For a game app, the contrast is especially sharp: official or custom art belongs to the game; a generic lightning bolt does not. regards.design: “Emoji and generic line icons where pictures should be.”

### 6. Glassmorphism, glow blobs, frosted blur, neon edges, and coloured shadows, used as decoration

**What it looks like.** Blurred radial gradients behind the hero (“glow blobs and halos”). Frosted-glass panels over a plain background, where nothing meaningful shows through. Soft violet blurs under buttons. Neon glow on dark-mode borders. Impeccable groups this as “Lazy ‘Cool’”: “Glass panels, neon edges, and glowing orbs pile up without helping you use the page.” deslopmydesign: “Glassy blur for no reason.”

**Why it happens.** Backdrop-blur and large tinted shadows are common “premium” tricks in tutorials and Dribbble-like shots. They photograph well in a screenshot, so models reach for them when asked to make a UI look polished. Each effect is added locally, with no check of whether anything is actually visible behind the glass.

**Why it reads as low quality.** Decoration competes with the task. On real phones, frosted bars can smear the text and controls sitting in them, which is a functional failure, not just a taste issue. deslopmydesign’s rule is the right one: “Use blur only over rich imagery; otherwise solid surfaces read better.” Apple’s older guidance is more careful than the default: translucency can “hint at the content behind” it, which is a reason; blur over a flat colour is not.

### 7. Pill badges, eyebrow labels, left-border stripes, and “everything fully round”

**What it looks like.** A small pill above the headline (“New,” “AI-powered,” “FEATURES”). Tiny uppercase, wide-tracked labels that repeat the heading below them. A coloured stripe down the left (or top) of every card, alert, or quote, whether or not it marks a status. Pill buttons, pill badges, and very large radii on cards, all at once. Impeccable: “Side-Tab Cards” and “Lazy ‘Impact’,” where “buttons bounce, icons wiggle, and badges float. Everything asks for attention at once.” RJ Patinio calls the left-border stripe “one of the strongest tells.” A designer quoted by Adrian Krebs said “colored left borders are almost as reliable a sign of AI-generated design as em-dashes for text.”

**Why it happens.** “Friendly” is read as “round” and applied to all of it (Strict Themes). Badges and stripes are cheap ways to make a block feel labelled or emphasised. The model adds them even when they carry no status.

**Why it reads as low quality.** When everything asks for attention, nothing has it. A badge that adds no information is noise. A stripe that does not mean “error,” “selected,” or “active” is decoration pretending to be structure.

### 8. No system: equal weight, off-scale spacing, a new grey or type size per element, inconsistent components across screens

**What it looks like.** Every card and section has the same visual weight and the same padding, so nothing leads. Body, caption, hint, and border each get their own grey. Font sizes that nearly match (13, 14, 15, 16, 17px). Padding of 14px here, 18px there. Icons mixed at 16px and 24px with different stroke widths. Borders and soft shadows used together everywhere. Controls that should be shared (a leave button, a save action, a sticky header) look or behave differently from screen to screen.

**Why it happens.** “Each element is decided alone” (Strict Themes). Without a short list of allowed values, the agent tunes by eye, one node at a time, and does not reconcile this screen with the last one. This is the deepest tell, and Strict Themes treats greys, type, and spacing as “one fault, a page with no system.” Ralabs and the Hacker News “UI-stack” discussion make the same point: the 50th component looks nothing like the first.

**Why it reads as low quality.** Humans are very good at noticing inconsistency, even when they cannot name it. Nielsen Norman Group’s consistency heuristic is the old version of this: “Users should not have to wonder whether different words, situations, or actions mean the same thing.” Apple’s 2013 HIG asks, “Do custom UI elements look and behave the same throughout the app?” A Reddit comment in r/UI_Design nailed the feeling: “uniform spacing and equal-weight cards everywhere so nothing has a clear hierarchy.” Another: AI UIs “lack direction about what visitors should be drawn to.”

### 9. Pretty on the happy path, unfinished everywhere else (and sometimes fake)

**What it looks like.** A polished first screen or landing page for a product that is still thin. Missing or generic empty, loading, error, permission, and validation states. Placeholder copy such as “Something went wrong. Please try again.” Hover states that make a thing look clickable when it is not. Fake stats (“10,000+ happy customers”), stock testimonials, and logos that were never earned. Content that stays invisible until a scroll or entrance animation fires. Agent Design and Ralabs both treat real states as the test of whether the design was thought through or only skinned.

**Why it happens.** Prompts and demos describe the happy path. Models are trained on static structure more than on interactive behaviour. Paul Bakaus and Business Insider’s sources (Shin, Samant, Das) all say the same thing: AI “optimize[s] for the happy path and tend[s] to produce interfaces that look complete until someone actually uses them.” Functional gaps (no validation, no required-field indicators, weak accessibility) are “usually missing.”

**Why it reads as low quality.** This is the tell that matters most in a real product. A beautiful empty state with no next step, or a control that looks live and does nothing, breaks trust. Das’s example: hover gives a shaded outline and a size increase that “suggests it can be clicked for more info, but clicking it yields nothing.” Fake metrics are dishonest in the sense Dieter Rams meant: “Good design is honest. It does not make a product appear more innovative, powerful or valuable than it really is.”

### 10. Low-contrast grey text, and motion that is there to look polished

**What it looks like.** Light grey captions on white, or mid-grey body text on near-black, that fails or barely meets contrast. Pale grey that “reads as elegant in a mockup and fails on a real screen” (Strict Themes). On the motion side: fade-and-slide on every section, hover-lift on every card, parallax, looping blobs, pulsing dots, buttons that bounce. Agent Design: “Agents love animation because it looks ‘polished’ in a screenshot. In production, it reads as cheap.”

**Why it happens.** Low-contrast grey is a common “quiet secondary text” pattern in design systems and screenshots. Motion is an easy way to answer “make it feel premium.” Both are applied everywhere, because there is no rule saying where they are allowed.

**Why it reads as low quality.** If the smallest text cannot be read at arm’s length in daylight, the typography is not refined; it is broken. If the page depends on animation to feel complete, or if text starts invisible until JavaScript runs, the polish is getting in the way (RJ Patinio notes this can also delay Largest Contentful Paint). Apple’s rule for animation is the right test: subtle, consistent, and in the service of understanding, not of spectacle.

**Also cited often, but slightly less universal:** dark mode as a default for products that are not developer tools; stock 3D blobs or dot grids in the hero instead of the product; numbered 1-2-3 step rows and stat banners; modal abuse (cramming a whole settings page into a scrolling dialog); crushed letter-spacing on huge headlines; “Welcome back, Sam” plus a sparkle on every screen.

**A note on toasts.** “Too many toasts” is a real usability problem, but it did not come up as often as the tells above in the slop-specific writing. The closely related, well-sourced patterns are Impeccable’s “everything asks for attention at once,” Impeccable’s “Modal Abuse,” and Apple’s long-standing rule: “Avoid unnecessary alerts… If users see too many alerts that don’t contain essential information, they quickly learn to ignore all alerts.” For TallyIt, the useful rule is the Apple one, applied to toasts, banners, and modals.

---

## 3. Does “every UI element must have a reason to exist, and a reason for where it sits” hold up?

Yes. It is one of the most widely supported principles in design, and it is also the best single antidote to AI slop, because slop is what you get when elements arrive without a decision. The sources below corroborate it. They also add an important nuance: delight, beauty, and personality can be valid reasons, as long as they are chosen and they do not hide the task.

**Dieter Rams, “less, but better.”** In the ten principles for good design, Rams writes that good design “emphasizes the usefulness of a product whilst disregarding anything that could detract from it”; that it is “thorough down to the last detail” because “nothing must be arbitrary or left to chance”; and that “good design is as little design as possible. Less, but better.” Principle 8 is almost a word-for-word match for the proposed rule: if a control, badge, or effect cannot be justified, it is arbitrary. Principle 3 and principle 2 add the nuance: “The aesthetic quality of a product is integral to its usefulness,” and a product must satisfy “not only functional, but also psychological and aesthetic criteria.” Personality is allowed. Random decoration is not.

**Nielsen Norman Group, aesthetic and minimalist design (Heuristic 8).** The heuristic, unchanged since 1994, is: “Interfaces should not contain information which is irrelevant or rarely needed. Every extra unit of information in an interface competes with the relevant units of information and diminishes their relative visibility.” The 2021 NN/g article on the heuristic is explicit: “Clarity will always win over visual flourish.” “Every piece of content should have a purpose, including negative space.” “Communicate; don’t decorate.” The same article supplies the nuance. This is not a brief for the “minimalist” visual trend, and a design can be dense and still satisfy the heuristic if everything present is needed. Removing necessary controls in the name of cleanliness fails the heuristic. Aesthetics also matter: users form an aesthetics-driven first impression in about 50 milliseconds, and Don Norman’s line, quoted there, is “attractive things work better.” NN/g also quotes William Morris, via Norman: “Have nothing in your houses that you do not know to be useful, or believe to be beautiful.” Beauty is a reason. “Decoration only” is not.

**Edward Tufte, data-ink and chartjunk.** NN/g’s summary of *The Visual Display of Quantitative Information* (1983): data-ink is “the elements that convey information and cannot be removed without changing the visualization’s message.” Chartjunk is the opposite: “any visual element that isn’t really necessary and in fact distracts from the chart’s meaning.” Tufte: “Data graphics should draw the viewer’s attention to the sense and substance of the data, not to something else.” The same test applies to a scorecard or a history list: if a chip, shadow, or divider can be removed without losing meaning or making the screen harder to use, it is probably noise.

**Apple Human Interface Guidelines.** The 2013 iOS HIG, which set the Clarity / Deference / Depth themes still cited in current discussions of Apple’s design, is unusually direct:

- “A sharpened focus on functionality motivates the design.”
- “Adornments are subtle and appropriate.”
- “Let a focus on content and functionality motivate every design decision.”
- “The UI helps users understand and interact with the content, but never competes with it.”
- “Reconsider visual indicators of physicality and realism. Bezels, gradients, and drop shadows sometimes lead to heavier UI elements that can overpower the content.”
- On planning: list possible features, then “filter the feature list through the audience definition.” “Great iOS apps have a laser focus on the task they help users accomplish.” Use an app definition statement “to determine the suitability of features, controls, and terminology.”
- Aesthetic integrity “doesn’t measure the beauty of an app’s artwork or characterize its style; rather, it represents how well an app’s appearance and behavior integrates with its function.” A serious task should keep “decorative elements subtle and unobtrusive.” A game, by contrast, should look and feel like a game. The appearance has to integrate with the purpose, not be pasted on.
- Consistency inside the app: “Do custom UI elements look and behave the same throughout the app?”
- “Avoid unnecessary alerts.”
- “Think like a newspaper editor, and watch out for redundant or unnecessary words.”

Current Apple documentation lives at the Human Interface Guidelines and has since added Liquid Glass as a material for the floating control layer, not for content. The older principle still applies, and recent accessibility criticism of over-transparent bars is a reminder that a fashionable material is not a reason by itself. Use blur or glass when it serves hierarchy and something real shows through; do not use it as a default coating.

**Refactoring UI (Adam Wathan and Steve Schoger).** The book itself is not free, so this section relies on Joel Sleppy’s published notes (March 2023), not on invented quotations from the book. The notes emphasise systems over one-off decisions: define scales for type, weight, colour, margin, padding, radius, and shadow, and limit choices. “Looks too busy if all elements are equal.” Use size, weight, and colour to build hierarchy; de-emphasise what is secondary. “There should be more space around a group than within it.” “If something is longer than 2–3 lines, don’t center-align.” “Use fewer borders,” substituting spacing or a background shift. Don’t leave empty states blank. Those are all forms of “every element, and its position, must earn its place.”

**How this maps to slop.** The slop literature is, almost without exception, a restatement of the same principle in new clothes. Strict Themes: “The tells are defaults, not choices.” Ralabs’s review questions begin with “What does this screen want someone to do, and is that the most important thing available?” and “Which choices here are specific to this product, and which would work unchanged on someone else’s?” RJ Patinio: “A good check asks: would a real designer have chosen this for this product? If the honest answer is ‘no, the AI just did it’, change it.” regards.design: none of the tells is wrong on its own; they read as vibe-coded when they arrive together because nobody art-directed the page. Inter, a gradient, or a card is fine “when someone chose it.”

**The nuance to keep.**

- A reason can be functional (this button logs the game), structural (this spacing groups the scores), or expressive (this tile uses official box art so the game is recognisable, or this theme colour makes Hearts feel like Hearts). Delight and personality count, if you can name them.
- A reason is not “it looked more complete,” “other AI apps do this,” or “the model added it.”
- Minimalism is not the goal. Necessary controls, including Leave, Log, and Delete, must stay, and they must sit in a predictable place. A sparse screen that is missing a way out fails the heuristic.
- Beauty and first impression matter. Stripping the product to wireframe grey would also be a failure, especially for a game app. Official art, theme colour, and a bit of craft are not slop.
- Placement is part of the test. An element can be justified and still be in the wrong place (a sticky header that sits under a camera cutout, or a primary action that changes position from game to game).

**Verdict.** The principle holds, and it is the right one for TallyIt. Phrase it as: every element must have a reason to exist and a reason for where it sits; valid reasons include use, clarity, consistency, and chosen personality; “the default arrived” is not a reason.

---

## 4. Anti-slop checklist for TallyIt

Use this on a real screen, at phone, tablet, and desktop sizes. A rule fails if you cannot point to the evidence on that screen. These are written for a game score tracker, not for a SaaS marketing page, but they are drawn from the sources above.

1. **Every visible element must have a job you can say in one sentence** (complete a task, show status, create hierarchy, or express a named part of the product’s personality). No element stays only because it made the screen look more complete.
2. **No decorative effect unless it marks real state or sits over content that needs it.** No gradient, glow, coloured shadow, left-border stripe, pill badge, chip, sparkle, or frosted glass “for polish.” A badge is allowed when it reports something true (for example, a saved game that was edited). A stripe is allowed when it means error, selected, or active.
3. **No blur or translucency that softens text or controls**, especially in sticky headers, tab bars, and toolbars on an iPhone. Use a solid surface unless something meaningful is actually visible behind the bar.
4. **Every game must offer the same way out and the same way to save.** Leave, Log, Save, Delete, and Back must be present when they apply, labelled the same way, and sit in the same region of the screen from game to game. A missing Leave or Log on one title is a fail.
5. **Shared components must come from one system.** Headers, buttons, tabs, cards, type sizes, font weights, greys, radii, icon sizes, and spacing must repeat from a short scale. No one-off grey, no type sizes one or two pixels apart, no new corner radius for a single screen.
6. **One thing on each screen must lead.** If you squint or blur the screenshot, the primary information and the primary action still stand out. Equal-weight cards, equal padding on every block, or several accent colours fighting for attention is a fail.
7. **No card inside a card unless the inner object is distinct** (selectable, tappable as a unit, or a record of its own). Prefer spacing or a single divider to a second box.
8. **Copy must be specific to this game or this task.** If a label, heading, empty-state sentence, or button title could be pasted onto a different product without changing a word, rewrite it. No “supercharge,” “unlock,” “seamless,” “elevate,” “all-in-one,” or similar filler. If removing a line changes nothing, delete it. Buttons are verbs with objects (“Log game,” “Delete game”), not “Get started” or “Learn more.”
9. **Icons and tile art must be chosen, consistent, and specific.** Official box art or one consistent custom set. No emoji standing in for icons. No generic rocket, sparkle, or lightning bolt. An icon tile must not be more prominent than the thing it introduces.
10. **Empty, loading, error, permission, and validation states must exist and sound like a person**, with a next step. “Something went wrong. Please try again.” is a fail if it is the only error the screen has.
11. **Nothing looks interactive unless it is.** Hover, press, and focus treatments belong only on real controls. A row, card, or icon that enlarges or outlines on press must go somewhere or do something.
12. **Motion must have a job.** Use it to orient, confirm, or explain (for example, a slightly slower transition that paints the destination first). Keep micro-interactions short; Agent Design’s range of 150–300ms is a sensible default. Honour `prefers-reduced-motion`. Nothing loops forever. Content must not stay invisible waiting on an animation or on JavaScript.
13. **Text must meet WCAG AA contrast** (at least 4.5:1 for regular text, 3:1 for large text). Hierarchy comes from size and weight, not from pale grey. The smallest text on the screen must be readable at arm’s length in daylight.
14. **Spacing must come from a short scale, and groups must be tighter inside than between.** The same padding on every section is a fail, because it makes everything equally important.
15. **No fake proof and no unused chrome.** No invented stats, placeholder testimonials, or decorative “New” labels. No control, tab, or setting that is visible but does nothing. If a feature cannot be justified for the person on this screen, it does not ship.
16. **Alignment is a decision, not a default.** Body copy, lists, and score rows are left-aligned unless a short title or a single number is being featured on purpose. “Everything centered” is a fail.
17. **Typefaces are named on purpose.** If a default sans is used, that is a documented choice, not an accident, and it still needs a short, consistent scale. Headings, body, and labels should not each invent their own size.
18. **Accent colour is scarce, and it means something.** Use it for primary actions and real status, not as a wash on backgrounds, buttons, headings, and cards at once. Theme colours that belong to a specific game (Hearts, Catan, and so on) are a valid accent when they stay in that game’s screens.
19. **Toasts, banners, alerts, and modals only for important, ideally actionable information.** Do not interrupt scoring to confirm something obvious. If a message is easy to ignore, it should not have been an interruption.
20. **Game personality is allowed, defaults in costume are not.** Official art, a game’s own palette, and scoring chrome that could only belong to that title are good reasons. A pattern that could be swapped onto a different product (a generic three-card row, a purple glow, a sparkle badge) is not personality.

**How to run the checklist.** Open one screen. Walk the twenty rules. Then open the same flow in its empty, loading, and error states, and open the matching screen in every game that has one. The hard failures for a score tracker are almost always consistency of controls, missing states, decoration that fights the content, and chrome that has no job.

---

## 5. Sources actually opened

### Definition and origin

- Wikipedia, “AI slop”: https://en.wikipedia.org/wiki/AI_slop
- Simon Willison, “Slop is the new name for unwanted AI-generated content” (8 May 2024): https://simonwillison.net/2024/May/8/slop/
- Deni Ellis Béchard, Scientific American, “AI Slop—How Every Media Revolution Breeds Rubbish and Art” (9 November 2025): https://www.scientificamerican.com/article/ai-slop-how-every-media-revolution-breeds-rubbish-and-art/
- Merriam-Webster, 2025 Word of the Year announcement via GlobeNewswire (15 December 2025): https://www.globenewswire.com/news-release/2025/12/15/3205236/0/en/merriam-webster-announces-slop-as-the-2025-word-of-the-year.html
- American Dialect Society, “2025 Word of the Year Is ‘Slop’” (9 January 2026): https://americandialect.org/2025-word-of-the-year-is-slop/

### UI and “vibe-coded” tells, 2025–2026

- Anthropic Applied AI, “Improving frontend design through Skills” (12 November 2025): https://claude.com/resources/articles/improving-frontend-design-through-skills
- Aditi Bharade, Business Insider, “3 Telltale Signs That You Used AI to Make Your App” (7 July 2026): https://www.businessinsider.com/ai-coded-app-user-interface-experience-design-2026-7
- Strict Themes, “AI slop in UI: the tells, and how to check for them” (checked 13 November 2026): https://strictthemes.com/guides/ai-slop-ui-tells/
- Dmytro Makarov, Ralabs, “AI Design Slop: How to Tell if an Interface was Actually Designed” (1 October 2026): https://ralabs.org/blog/ai-design-slop-how-to-review-ai-generated-interfaces/
- Impeccable (Paul Bakaus), “Slop” catalogue: https://impeccable.style/slop/
- RJ Patinio, “Are You a Vibe Coder? How I Catch AI Slop in Frontend Design” (19 November 2026): https://rjpatinio.com/blog/are-you-a-vibe-coder-how-i-catch-ai-slop-in-frontend-design
- Filip Wojda, regards.design, “How to make a website look less vibe coded (and less AI)” (21 October 2026): https://www.regards.design/blog/make-website-look-less-vibe-coded
- Agent Design, “The Anti-Slop Design Checklist for Vibe Coders” (4 July 2026): https://agent-design.com/blog/anti-slop-design-checklist
- illos.dev, “Why vibe-coded websites look the same” (checked 10 November 2026): https://illos.dev/guides/vibe-coded-websites
- deslopmydesign, “AI Design No-Nos”: https://deslopmydesign.com/no-nos
- prg.sh, “Why Your AI Keeps Building the Same Purple Gradient Website” (26 October 2025): https://prg.sh/ramblings/Why-Your-AI-Keeps-Building-the-Same-Purple-Gradient-Website
- Jason Lemkin, SaaStr, “Gemini 3 Solves One of the Biggest Headaches With Vibe Coding…”: https://www.saastr.com/gemini-3-solves-one-of-the-biggest-headaches-with-vibe-coding-now-your-site-doesnt-have-to-look-like-it-was-vibe-coded/
- Adrian Krebs, “Scoring Show HN submissions for AI design patterns” (20 April 2026): https://www.adriankrebs.ch/blog/design-slop
- Pavithra Lamahewa, Slop Patterns: https://sloppatterns.com/
- Hacker News, “Slightly reducing the sloppiness of AI generated front end” (12 June 2026): https://news.ycombinator.com/item?id=48504912
- Reddit, r/UI_Design, “What is it about AI-designed interfaces that makes them so obvious?”: https://www.reddit.com/r/UI_Design/comments/1xifkp9/what_is_it_about_aidesigned_interfaces_that_makes/

### Canonical design principles

- Dieter Rams, Ten Principles for Good Design: https://tenprinciples.design/
- Jakob Nielsen / Nielsen Norman Group, “10 Usability Heuristics for User Interface Design”: https://www.nngroup.com/articles/ten-usability-heuristics/
- Therese Fessenden, Nielsen Norman Group, “Aesthetic and Minimalist Design (Usability Heuristic #8)” (24 January 2021): https://www.nngroup.com/articles/aesthetic-minimalist-design/
- Kate Moran, Nielsen Norman Group, “Clutter-Free: One of the 3 Cs for Better Charts” (6 February 2022), quoting Edward Tufte, *The Visual Display of Quantitative Information* (1983): https://www.nngroup.com/articles/clutter-charts/
- Apple, *iOS Human Interface Guidelines* (2013 PDF, including Clarity, Deference, Depth, aesthetic integrity, and feature filtering): https://aresluna.org/ui-style-guides/Apple%20iPhone/iOS%20Human%20Interface%20Guidelines%20(2013).pdf
- Apple, current Human Interface Guidelines (design principles index; the live page should be checked when a current wording is needed): https://developer.apple.com/design/human-interface-guidelines/design-principles
- Joel Sleppy, “Notes on Refactoring UI” (18 March 2023), notes on Adam Wathan and Steve Schoger, *Refactoring UI*: https://www.joelsleppy.com/blog/notes-on-refactoring-ui/
