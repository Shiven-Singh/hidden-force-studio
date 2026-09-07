# Architecture

One ADK `SequentialAgent` runs the stages in fixed order. Stages 3 and 4 sit inside a `LoopAgent` capped at three iterations. Every stage reads typed state and writes typed state through the zod models in `hfs-schemas`. No stage decides what runs next.

```
bible JSON
   |
   v
[1] intake          BaseAgent        validate, seed state
[2] research        BaseAgent        Parallel Search x2 -> sources (advocacy + general)
    rubric          LlmAgent         Gemini, t=0 -> rubric_draft
    rubric_merge    BaseAgent        sources attached by code -> rubric
   |
   v  LoopAgent, maxIterations 3 (White, Blue, Pink)
[3] story           LlmAgent         Gemini -> screenplay (beats + Fountain)
[4] gate            BaseAgent        code checks + Gemini scores, evidence verified -> review
   |  escalate on PASS
   v
[5] lock_character  LlmAgent         Gemini, t=0 -> locked description
    art_direction   BaseAgent        hash + shot prompts, code only
    storyboard      BaseAgent        one still per shot, gemini-3.1-flash-image, 3 at a time
[6] package         BaseAgent        outputs/<name>_<ts>/, GCS copy, run manifest
[7] render          on request       8 Veo 3.1 clips -> ffmpeg -> animatic/animatic.mp4
```

Stages 5 and 6 read `review.verdict` first. On anything other than PASS, art direction is skipped and package writes the rubric, the review history, the rejected draft, and a manifest that says HALT.

## Where the required services are called

| Service | File | What |
|---|---|---|
| Google Cloud Agent Builder, ADK for JavaScript (`@google/adk`) | `hfs-api/src/agent.ts` | `LlmAgent`, `LoopAgent`, `SequentialAgent` composition |
| Gemini on Vertex AI (`@google/genai`) | `hfs-api/src/clients/gemini.ts` | direct structured call from the gate |
| Parallel Search API (`parallel-web`) | `hfs-api/src/clients/parallel.ts` | two searches per run, results stored verbatim |
| Gemini image model and Veo on Vertex AI | `hfs-api/src/clients/media.ts` | storyboard stills, film clips |
| Cloud Storage | `hfs-api/src/clients/media.ts` | every run file copied to `OUTPUT_BUCKET` |

## Runtime

`hfs-api/src/server.ts` is an Express server. A run is a background job keyed by id; the browser polls `/api/runs/:id` every two seconds. The Next.js app in `hfs-frontend` is a static export served by the same server. One Cloud Run service, one URL.
