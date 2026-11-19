# Studium: what comes after 0.6.0, and why it waits

Every idea he sent for Studium, with where it goes and what it needs first. His words are in
`caspian-kb/rules/sources/`; the items Squire made of them are in `caspian-kb/agenda/inbox/`. Written 2026-11-19 by the
Studium brigadista and revised with his answers the same day. It is a proposal: each version after 0.6.0 is settled
with him when its turn comes, with its own plan, as he asked ("primero tienes que pensarlo bien antes de implementar
cualquier cosa").

## The criteria (his, applied to every item)

From `2026-11-16T223513Z` [09:14]–[11:46] and `2026-11-16T225150Z` [02:39]:
- **Extremely easy.** About three clicks, few fields, nothing that demands attention every so often.
- **Simple is not limited.** Whoever wants control can go deeper.
- **Autonomous or not at all.** "Esto no debe depender de actualización manual ... si es que no funciona bien por sí
  mismo, entonces mejor no implementar."
- **Consulted with him first** where he said so: benefits, places to eat, prices and maps.

Two constraints of the project, which the plans keep:
- **The free plan.** Reads stay within Firestore's free quota.
- **No server.** Never a scheduled job or a timer.
  - Some ideas need a server: payments, checking a post at the moment it is published, notifications to Squire.
  - They need either a change of plan (Blaze, with billing) or a design that does without it.
  - That is his decision, and it is asked before the version that needs it.

## Where each idea goes

| Version | What | His source |
| --- | --- | --- |
| **0.6.0** | Lag, schedule and «Elegir materias» with the mallas, landing, friends, avatars (preset), groups, shared schedule and «¿cuándo podemos todos?», music, professors' post-its, feedback and «Escríbeme», the guide to the university, the game, the sound session | 11-13 session, 11-11T003026Z, 11-11T184645Z, 11-16T205412Z, 11-16T220707Z, 11-16T221205Z, 11-17T215959Z, 11-17T221233Z, 11-17T222026Z, 11-18T192833Z |
| **0.7.0** Tu semana | To-dos, a calendar of classes, study and deadlines, homework in three clicks, tips for every semester | 11-16T223513Z, 11-17T215959Z |
| **0.8.0** Members who publish | Tutoring, events and «busco equipo», community projects | 11-16T222024Z, 11-17T230414Z |
| **Later, with research** | Donations and perks, vacas, marketplace, Studium Pool, materials and budgets, benefits, places to eat, forum, legends, admin AI monitoring | 11-16T221518Z, 11-16T221205Z, 11-16T225150Z, 11-16T223513Z, 11-17T223328Z, 11-17T224131Z |

## 0.7.0, Tu semana

- **To-dos.**
  - A button anywhere: «Tengo que…», one line and optionally a when.
  - A to-do that is study ("estudiar cálculo") offers a free slot of the schedule. One tap places it.
- **The calendar.**
  - «Tu semana» grows into a calendar: classes (0.6.0), study blocks, deadlines (`deadlines` of today), group sessions
    (0.6.0).
  - What is next is visible at a glance: "ahorita es hora de estudiar para cálculo".
- **Homework in three clicks.**
  - A screenshot of D2L is read by the person's own AI. The ways of `ai.js` already do this, as the schedule's import
    does in 0.6.0.
  - It proposes the dates found, the person ticks them, and they are saved.
  - No scraping with the person's university password: Studium never holds it.
- **The AI places study, if asked.** Using the free hours of the schedule, as he said: "la IA podría apoyar ahí
  opcionalmente".
- **Tips for every semester.** «Elegir materias» of 0.6.0 grows to all of them, including general-education classes,
  with what students share about them.

## 0.8.0, members who publish

0.6.0 builds what this needs once, for the professors' post-its: reports, hiding past a threshold, admin review in the
panel, limits of size and rate. Every item here reuses it.

Members talk to each other here, so the rule between members holds: nothing is written against another member.

- **Tutoring** (`2026-11-16T222024Z`).
  - Who teaches what, when, free or paid, and how to contact them. Alumni included, and him as a tutor.
  - The Learning Center's hours, if they can be read without manual upkeep; otherwise a link.
  - Studium only lists. Payment is between the people.
- **Events and «busco equipo»** (`2026-11-17T230414Z`).
  - Hackathons and competitions announced by members, and a way to say "voy, busco equipo" or "busco con quién ir".
  - This "con quién ir" is the part of Studium Pool (below) that needs neither cars nor money.
- **Community projects** (`2026-11-17T230414Z`): a place to show something useful a student found or made, with a
  link and a few words.

## Later: needs research, and his decision on each

| Idea | What it needs first | Why it is not earlier |
| --- | --- | --- |
| **Donations and perks** (11-16T221518Z, 11-16T225150Z [06:18]) | The unified donation system for all his pages (its own registry entry, `sistema-unificado-de-donaciones`); a provider that works in Ecuador; what a perk is in Studium | Studium's part is small once that system exists. Built alone first, it would be a second system to merge later. The playful message for someone who declines ("¿aunque sea 50 centavos?") is written then. |
| **Vacas** (11-16T221205Z) | Posts of «busco gente para…» and «nos falta uno», with the slots left; his own conditions: "el estudio no se responsabiliza", with responsibilities stated clearly, and fraud "absolutamente mínima" (verified members, reputation, how payment is agreed) | Money between strangers: it needs the reports and review of 0.6.0 working first, and a way to make fraud minimal that he approves. |
| **Marketplace** (11-16T225150Z) | Real photos (file storage, which Studium does not have); categories (study first, the rest apart, as he said); a mandatory 5% means Studium handles payments, which in Ecuador means invoicing (SRI) and refunds | Errors here cost people money. It is the most exposed feature of all. |
| **Studium Pool** (11-16T225150Z) | Legal research: paid rides in private cars are regulated in Ecuador. Safety: verified members, shared trip details, anonymized sectors, as he corrected himself. | "Busco con quién ir" to an event comes in 0.8.0 with events. Cars and fares wait. |
| **Materials, budgets and stores** (11-16T223513Z) | A source of prices that updates itself; consulted with him | "no es una prioridad ahora para nada"; without an autonomous source it would be stale in a month. A per-course list of materials, made by students like the mallas, may come first; prices only with a source. |
| **Student benefits, GOBE** (11-16T223513Z) | Whether GOBE's posts can be read without breaking a platform's terms; consulted with him | He said: only when the information exists, and only after asking him. |
| **Places to eat** (11-16T223513Z) | Data; "si es que no hay data, mejor no poner esta funcionalidad" | It would join «¿cuándo podemos todos?» of 0.6.0, if data exists. |
| **Forum** (11-17T230414Z) | Reports and review working well for a semester | He named the risk himself: "forums siempre son una posible fuente de ... interacciones poco agradables". |
| **Legends** (11-17T223328Z, 11-17T224131Z) | Consent of each nominee before they appear; categories; votes per semester with a threshold (his idea: five); a way to mark graduates | He called it optional. It names real people, so nobody appears without saying yes. The names he mentioned stay in his notes, not in this public repository. |
| **Admin AI monitoring and Squire** (11-16T225150Z [02:01]) | The 0.6.0 feedback; for the notice to Squire, a server or a step in GitHub Actions | The on-demand summary in the panel comes in 0.6.0. A fix made by an agent, waiting only for his merge with a message through Squire, belongs to the fleet's work, built with it. |
| **Profile pictures and avatar builder** (11-16T221205Z) | File storage and moderation for uploads | Preset avatars come in 0.6.0. A Duolingo-like builder (no uploads, no moderation) can follow in any version. |
| **A 3D map of the campus** (11-17T222026Z) | The 2D map of 0.6.0 in use | He said: "podríamos empezar solo con un mapa 2D". |

## What this file is not

It is not a promise to anyone. The landing never shows it. Each version gets its own plan in `docs/`, made with him,
when its turn comes.
