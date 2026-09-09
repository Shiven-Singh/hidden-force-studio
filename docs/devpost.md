# Devpost form copy

Paste as is. Track: **Parallel**.

## Project overview

**Project name**
Hidden Force Studio

**Tagline**
Short animated films where a kid's disability is the superpower.

**Elevator pitch (under 200 characters)**
Pick a kid hero with ADHD, autism, dyslexia, anxiety, deafness or a wheelchair. Half an hour later you have an animated short where that trait is their superpower. Get the kid wrong and it refuses.

## Project details

**About the project** (Markdown)

```markdown
## Inspiration

I have six kid characters I have been writing for the six-to-nine age group. Each of them has something the world calls a problem: ADHD, autism, dyslexia, anxiety, deafness, a wheelchair. In their stories it is the reason they win.

What kills projects like this is not the writing. It is the review. Nobody on a small team has lived the trait, the guidance is scattered across advocacy groups and changes from one trait to the next, and a single "miracle cure" ending sinks the whole thing. I wanted a studio that gets the kid right before a human reader ever sees a draft, and that says no when it cannot.

## What it does

You pick a hero. Half an hour later you have a short animated film where that kid's trait is their superpower.

In between, the studio:

- finds out how that kid should be shown, from disability groups and writers' style guides, using Parallel's Search API, and writes rules for this one story with a link back to every source;
- writes the script, then checks every line against those rules. A line that breaks one goes back to the writer with the exact quote. Three strikes and it stops: no storyboard, no film;
- pins down how the kid looks so the same child appears in every frame, draws a twelve-frame storyboard, films eight shots with Veo, narrates them, and cuts a 72-second short with a title card and an end card that says what the review found.

Everything it made is on the page in plain language: the sources, the rules, each draft, every check, and the film. Two of the ten runs in the repo were refused. That is the point.

## How we built it

![How it is built](https://raw.githubusercontent.com/Shiven-Singh/hidden-force-studio/main/docs/architecture.png)

- **Google Agent Development Kit for JavaScript.** One `SequentialAgent` runs nine stages in a fixed order. Script and review sit inside a `LoopAgent` capped at three drafts.
- **Gemini on Vertex AI.** Gemini 3.5 Flash writes. Gemini 3.1 Pro compiles the rules and reviews at temperature zero, a different model from the writer on purpose. Gemini 3.1 Flash Image draws the storyboard.
- **Parallel Search API.** Two searches per story: advocacy and style-guide domains first, then the open web. Sources are stored verbatim and every rule cites one.
- **The review.** Code checks the narration for deficit language. The model scores the rest, and every score must quote a line that exists in the script, verified in code. A quote that does not exist fails the check.
- **Veo 3.1, Cloud Text-to-Speech, ffmpeg** for the film.
- **TypeScript end to end.** Zod schemas shared between the API and the page. Express on Cloud Run owns each run as a background job, every file lands in Cloud Storage, and a Next.js static page is served by the same service.

## Challenges we ran into

- Keeping the reviewer honest. The rules come from cited external sources, the reviewer can only cite lines that exist, and anything it cannot back up counts as a failure.
- Making the "it refuses" demo real. A writer working under the rules would not write a cure ending even when the premise asked for one. So the rigged hero writes its first draft without the rules and gets them back for the revision.
- Video. ffmpeg will encode forever if you let it, and image quotas on a fresh project mean drawing one frame at a time.

## Accomplishments that we're proud of

- Ten real runs in the repo, unedited. Six heroes pass. Three finished films.
- The rigged hero is refused on the first draft with the exact line quoted, "leaving the wheelchair behind in the mud for good", and passes on the second with the chair in the final scene.
- One hero I did not rig was refused three times for the savant-genius trope, on a rule the studio took from a real source, and passed after I rewrote the premise.
- Zero unverifiable quotes across every run.

## What we learned

The constrained writer follows the rules better than expected, so the review earns its keep on the unexpected cases, not the average one. A review that reports findings with evidence, rather than approving, is the honest shape for this. A reader from the community stays the last pass. Now they read the last draft instead of the first.

## What's next for Hidden Force Studio

A sign-off step for a human reader after the review. The same review applied to short ad variants. A library so families can find a short that matches their kid.
```

**Built with** (tags, one per line)

```
google-cloud
vertex-ai
gemini
veo
google-adk
cloud-run
cloud-build
cloud-storage
cloud-text-to-speech
secret-manager
parallel-search-api
typescript
node.js
express
next.js
react
zod
ffmpeg
pnpm
vitest
```

**"Try it out" links**

```
https://hidden-force-studio-gdxyknxydq-uc.a.run.app/?run=zayan_20260907T201737
https://github.com/Shiven-Singh/hidden-force-studio
```

**Image gallery**
Drag in the files under `docs/gallery/`, in order. All are 3:2.

**Video demo link**
Your public YouTube URL.

## Additional info, likely questions

**Track**
Parallel.

**Google Cloud products used**
Vertex AI (Gemini 3.5 Flash, Gemini 3.1 Pro, Gemini 3.1 Flash Image, Veo 3.1), Agent Development Kit, Cloud Run, Cloud Build, Cloud Storage, Cloud Text-to-Speech, Secret Manager.

**Partner technology used**
Parallel Search API, called at runtime on every run for the sources the rules are built from.

**How to test**
Open the live link. Click "Watch our films" for the finished runs, or "Build your own", pick a hero and click "Make the film". A run takes about twelve minutes for the script and storyboard and another fifteen for the film. The link updates to the run, so you can leave and come back.

**Is this a new project?**
Yes. Everything was built during the hackathon window. The six character bibles are pre-existing creative work of mine and are included under a separate content licence.
