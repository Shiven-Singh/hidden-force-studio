# Devpost form copy

Paste as is. Track: **Parallel**.

**Project name**
Hidden Force Studio

**Elevator pitch (under 200 characters)**
Pick a kid hero. Half an hour later, a short film where their ADHD or wheelchair is why they save the day. A script that gets the kid wrong never gets made.

**Hosted URL**
https://hidden-force-studio-gdxyknxydq-uc.a.run.app/?run=zayan_20260907T201737

**Repository**
https://github.com/Shiven-Singh/hidden-force-studio

**Built with**
Google Cloud, Agent Development Kit for JavaScript, Gemini on Vertex AI (3.5 Flash, 3.1 Pro, 3.1 Flash Image), Veo 3.1, Cloud Text-to-Speech, Cloud Run, Cloud Build, Cloud Storage, Parallel Search API, TypeScript, Node.js, Express, Next.js, zod, ffmpeg

**Inspiration**
Six characters I have been writing for the 6 to 9 age band, each with a neurodivergent or disabled trait treated as a power. What stops projects like this shipping is not the writing. It is the review layer: readers from the community are scarce, guidance is scattered across advocacy bodies and changes by trait, and one cure-narrative ending ends the project. I wanted a studio that does the pre-read before a human reader ever sees a draft.

**What it does**
You pick a hero. The studio fetches current portrayal guidance for that trait through Parallel's Search API, from advocacy and style-guide sources and from the open web, and compiles a rubric where every rule cites the source it came from. Gemini drafts a beat sheet and a screenplay under that rubric. A gate then scores the draft: deterministic checks on the narration, and model-scored rules where every finding must quote a line that exists in the script, verified in code. Broken rules go back to the writer with the offending lines. Two revisions maximum, then it refuses. A passing draft gets a locked character description, a twelve-frame storyboard drawn from that description, and a narrated 72-second film cut from Veo clips with a title card and an end card that says what the review found. All of it on one page: pick a hero, watch the steps tick by, watch the film, then read why it passed, with every source, rule and check in plain language.

**How we built it**
An ADK SequentialAgent with a LoopAgent around draft and review, in TypeScript on @google/adk 2.0. Zod schemas at every boundary, shared with the Next.js UI. Gemini 3.5 Flash drafts, Gemini 3.1 Pro reviews at temperature zero on a different tier from the drafter. Parallel Search runs twice per story, once restricted to advocacy domains, once open. Stills from Gemini 3.1 Flash Image, clips from Veo 3.1, narration from Cloud Text-to-Speech, cut with ffmpeg. Express on Cloud Run owns each run as a background job; every file lands in Cloud Storage and the page reads finished runs from there.

**Challenges**
Keeping the reviewer honest: the rubric comes from external cited sources, the reviewer can only cite lines that exist, and unverifiable evidence fails closed. Making the adversarial demo real: a rubric-constrained writer would not produce a cure narrative even when the premise asked for one, so adversarial bibles draft once without the rules and revisions get them back. And ffmpeg, which will happily encode forever if you let it.

**Accomplishments**
Nine committed, unedited runs. Six heroes pass. The adversarial bible is refused on its first draft with the exact line quoted, and passes on the second with the wheelchair in the final scene. One hero I did not rig was refused three times for the savant-genius trope on a rule the rubric pulled from a real source, and passed after the premise was rewritten. Zero unverifiable quotes across all of them.

**What we learned**
The constrained drafter is better at the rules than you expect, so the gate's value shows up on the adversarial and the unexpected cases, not the average one. Image and video quotas on a fresh project are small, so storyboards draw one frame at a time. And a gate that reports findings with evidence, rather than approving, is the honest shape for this: a community reader stays the last pass.

**What's next**
A human reader's sign-off step after the gate, a second adapter that applies the same gate to short-form ad variants, and a library so families can find shorts that match their kid.
