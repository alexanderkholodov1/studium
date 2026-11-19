# Studium: what comes after 0.6.0, and why it waits

Every idea he sent for Studium, with where it goes and what it needs first. His words are in
`caspian-kb/rules/sources/`; the items Squire made of them are in `caspian-kb/agenda/inbox/`. Written 2026-11-19 by the
Studium brigadista. It is a proposal: the versions after 0.6.0 are settled with him one at a time, each with its own
plan, as he asked ("primero tienes que pensarlo bien antes de implementar cualquier cosa").

## The criteria (his, applied to every item)

From `2026-11-16T223513Z` [09:14]–[11:46] and `2026-11-16T225150Z` [02:39]:
- **Extremely easy.** About three clicks, few fields, nothing that demands attention every so often.
- **Simple is not limited.** Whoever wants control can go deeper.
- **Autonomous or not at all.** "Esto no debe depender de actualización manual ... si es que no funciona bien por sí
  mismo, entonces mejor no implementar."
- **Consulted with him first** where he said so: benefits, places to eat, prices and maps.

Two constraints of the project, which the plans keep:
- **The free plan.** Reads within Firestore's free quota.
- **No server.** Never a scheduled job or a timer.
  - Whatever needs a server (payments, AI moderation at the moment of posting, notifications to Squire) needs either a
    change of plan (Blaze, with billing) or a design that does without it.
  - That is his decision, and it is asked before the version that needs it.

## Where each idea goes

| Version | What | His source |
| --- | --- | --- |
| **0.5.4** (now) | Armar tu horario; «Elegir materias» for first semester | 11-17T221233Z, 11-17T215959Z |
| **0.6.0** | Lag, landing, friends, avatars (preset), groups, shared schedule and «¿cuándo podemos todos?», music, feedback and «Escríbeme», the game, the sound session | 11-13 session, 11-11T003026Z, 11-11T184645Z, 11-16T205412Z, 11-16T221205Z, 11-18T192833Z |
| **0.7.0** Tu semana | To-dos, a calendar of classes, study and deadlines, homework in three clicks, the guide to the university and tips by semester | 11-16T223513Z, 11-17T215959Z, 11-17T222026Z |
| **0.8.0** The community with words | The foundation for free text (moderation, reports, terms); then professors with post-its, tutoring, events and «busco equipo», community projects | 11-16T220707Z, 11-16T222024Z, 11-17T230414Z |
| **Later, with research** | Donations and perks, vacas, marketplace, Studium Pool, materials and budgets, benefits, places to eat, forum, legends, admin AI monitoring | 11-16T221518Z, 11-16T221205Z, 11-16T225150Z, 11-16T223513Z, 11-17T223328Z, 11-17T224131Z |

## 0.7.0, Tu semana

- **To-dos.**
  - A button anywhere: «Tengo que…», one line and optionally a when.
  - A to-do that is study ("estudiar cálculo") offers a free slot of the schedule. One tap places it.
- **The calendar.**
  - «Tu semana» grows into a calendar: classes (0.5.4), study blocks, deadlines (`deadlines` of today), group sessions
    (0.6.0).
  - What is next is visible at a glance: "ahorita es hora de estudiar para cálculo".
- **Homework in three clicks.**
  - A screenshot of D2L is read by the person's own AI. The ways of `ai.js` do this already; no new infrastructure.
  - It proposes the dates found, the person ticks them, and they are saved.
  - No scraping with the person's university password: Studium never holds it.
- **The guide to the university** (only for members), from his notes of `2026-11-17T222026Z`:
  - leos;
  - the Learning Center;
  - the library and its loans;
  - how to read a room code (a letter for the building, then floor and room);
  - a 2D map first;
  - D2L: uploads cannot be edited, attempts and quiz pages;
  - how grades work: the weight of each assignment, the letter ranges, what stays on the kardex.
- **Tips by semester.** The guide of 0.5.4 grows to every semester, including general-education classes.
- **Every fact is verified with him before it ships.** Some are open in his own notes: the semester of leos ("hay que
  verificar todavía"), the loan period of the library ("habría que investigar"), the cut of the letters.

## 0.8.0, the community with words

**Why it is one version, and why the foundation comes first.**
- Today every interaction in Studium is fixed and positive: four kinds of thanks, constructive tags, "the database
  accepts nothing else, so nobody can write anything negative" (README).
- Five of his ideas need people to write freely, in public:
  - the post-its about professors, including "no lo recomiendo";
  - tutoring profiles;
  - events;
  - community projects;
  - later, the marketplace.
- That is a change of principle, not a feature. It needs his explicit decision, and one shared foundation built once:
  - **Moderation.** A post waits until it is checked, by an admin with their own AI in the panel, on demand. Or it is
    checked at the moment it is posted, which needs a server: the Blaze question above. Recommended: the first, with
    trusted members (by age of account and past contributions) published at once and checked after.
  - **Reports.** Any member reports a post with one tap; past a threshold it is hidden until reviewed.
  - **Terms in plain words.** What Studium is responsible for and what it is not, written once and shown where it
    matters.
  - **Anonymous by default**, as he asked for the post-its, with the author known only to the rules and the admins, so
    that abuse can still be stopped.

**What is built on it.**
- **Professors** (`2026-11-16T220707Z`).
  - Post-its on the professors page that move on hover. Their color says whether the author recommends the professor.
  - Writing one is a few guided questions, all optional: how they grade, the syllabus, how much they help, how flexible
    they are, and free text for what fits no category ("está prohibiendo salir de clase").
  - Each post-it is tied to a course and a semester, because a professor changes from semester to semester.
  - **The AI summary.** For each professor and course, a short and clear summary: whether to take them, what to
    consider, what changed recently.
    - It is made on demand by an admin's AI and kept, not made by every visitor.
    - Every post-it can still be read.
  - The fixed tags of today stay, and become the quick answer for those who do not want to write.
- **Tutoring** (`2026-11-16T222024Z`).
  - Who teaches what, when, free or paid, and how to contact them. Alumni included, and him as a tutor.
  - The Learning Center's hours, if they can be read without manual upkeep; otherwise a link.
  - Studium only lists. Payment is between the people.
- **Events and «busco equipo»** (`2026-11-17T230414Z`).
  - Hackathons and competitions announced by members, and a way to say "voy, busco equipo" or "busco con quién ir".
  - This "con quién ir" is the safe part of Studium Pool (below), with no cars and no money.
- **Community projects** (`2026-11-17T230414Z`): a place to show something useful a student found or made, with a
  link and a few words.

## Later: needs research, and his decision on each

| Idea | What it needs first | Why it is not earlier |
| --- | --- | --- |
| **Donations and perks** (11-16T221518Z, 11-16T225150Z [06:18]) | The unified donation system for all his pages (its own registry entry, `sistema-unificado-de-donaciones`); a provider that works in Ecuador; what a perk is in Studium | Studium's part is small once that system exists. Building it alone first would make a second system to merge later. The playful message when someone declines ("¿aunque sea 50 centavos?") is ready to write then. |
| **Vacas** (11-16T221205Z) | Terms; a payment flow where Studium never holds money; anti-fraud (verified members only, reputation, limits) | Sharing one personal account of Claude, ChatGPT or Spotify between several people breaks those services' terms of use, and Studium would be the place that arranged it. Legitimate forms exist: plans with a seat per person (Claude Team, ChatGPT Business), group purchases of books, lab kits, components. The vaca should be built only for those. He said Studium takes no responsibility and fraud must be minimal; that needs the 0.8.0 foundation and payments. |
| **Marketplace** (11-16T225150Z) | The 0.8.0 foundation; real photos (file storage, which Studium does not have); categories (study first, the rest apart, as he said); a mandatory 5% means Studium handles payments, which in Ecuador means invoicing (SRI) and refunds | Errors here cost people money. It is the most exposed feature of all. |
| **Studium Pool** (11-16T225150Z) | Legal research: paid rides by private cars are regulated in Ecuador. Safety: verified members, shared trip details, anonymized sectors, as he corrected himself. | The free part, "busco con quién ir" to an event, comes in 0.8.0 with events. Cars and fares wait. |
| **Materials, budgets and stores** (11-16T223513Z) | A source of prices that updates itself; consulted with him | "no es una prioridad ahora para nada"; without an autonomous source it would be stale in a month. A per-course list of materials, made by students like the guides, may come first; prices only with a source. |
| **Student benefits, GOBE** (11-16T223513Z) | Whether GOBE's posts can be read without breaking a platform's terms; consulted with him | He said: only when the information exists, and only after asking him. |
| **Places to eat** (11-16T223513Z) | Data; he said "si es que no hay data, mejor no poner esta funcionalidad" | It would come with the scheduling of 0.6.0, if data exists. |
| **Forum** (11-17T230414Z) | The 0.8.0 foundation working well for a semester | He named the risk himself: "forums siempre son una posible fuente de ... interacciones poco agradables". |
| **Legends** (11-17T223328Z, 11-17T224131Z) | Consent of each nominee before they appear; categories; votes per semester with a threshold (his idea: five); a way to mark graduates | He called it optional. It names real people, so nobody appears without saying yes. The names he mentioned stay in his notes, not in this public repository. |
| **Admin AI monitoring and Squire** (11-16T225150Z [02:01]) | The 0.6.0 feedback; for the notice to Squire, a server or a step in GitHub Actions | The on-demand summary in the panel comes in 0.6.0. A fix made by an agent, waiting only for his merge with a message through Squire, belongs to the fleet's work, built with it. |
| **Profile pictures and avatar builder** (11-16T221205Z) | File storage and moderation for uploads | Preset avatars come in 0.6.0. A Duolingo-like builder (no uploads, no moderation) can follow in any version. |

## What this file is not

It is not a promise to anyone. The landing never shows it. Each version gets its own plan in `docs/`, made with him,
when its turn comes.
