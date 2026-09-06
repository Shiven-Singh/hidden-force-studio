# Hidden Force Studio

A deterministic six-stage pipeline that turns a character bible for a neurodivergent or disabled child hero into an animated short's pre-production package: logline, beat sheet, screenplay in Fountain, locked character sheet, shot list, and an audit manifest. Between drafting and packaging sits a gate that scores the draft against a rubric compiled from live, cited advocacy sources, and refuses to ship a draft that fails.

Built for the Agentic Cinema hackathon, Parallel track. The first user is the builder: the six Hidden Force characters are my own, and this is the tool I wanted for producing them.

It is not a replacement for a community sensitivity reader. It is the pre-read that catches the obvious failures so the paid human read is the last pass instead of the first. The gate never says "approved". It reports findings with evidence, and a person decides.

## Architecture

See [ARCHITECTURE.md](ARCHITECTURE.md). Short version: an ADK `SequentialAgent` with a `LoopAgent` around draft and review, zod validation at every boundary, Gemini on Vertex for drafting and review at different tiers, Parallel's Search API for research, Express on Cloud Run.

## The gate

Three hard-fail classes, documented in [docs/rubric.md](docs/rubric.md):

- **HF1, cure narrative.** The trait must be present and unchanged in the final scene. Model-scored, evidence verified in code.
- **HF2, deficit framing in the narrative voice.** Action lines are scanned against an avoid-list. Deterministic. Dialogue is exempt because other characters holding the deficit view is the story's arc.
- **HF3, inspiration porn.** The character must want something for themselves. Model-scored, evidence verified in code.

Every model score must quote a line that exists verbatim in the script. A quote that does not exist turns the score to "unclear", and "unclear" fails a hard rule. Two revisions maximum, then HALT.

## Where Google Cloud is called

- `hfs-api/src/agent.ts`: the ADK agents. `@google/adk` is the JavaScript form of `google-adk`.
- `hfs-api/src/clients/gemini.ts`: a direct structured Gemini call on Vertex AI via `@google/genai`.
- `hfs-api/src/agents/package.ts`: Cloud Storage upload of every run.

## Where Parallel is called

- `hfs-api/src/clients/parallel.ts`: `client.search()` twice per run, one search restricted to advocacy domains for the trait, one open web. Results are stored verbatim with their pool label and shown in the UI and in `portrayal_rubric.json`.

## Setup

Requires Node 20.19 or newer and pnpm.

```bash
pnpm install
cp .env.example .env        # fill in GOOGLE_CLOUD_PROJECT and PARALLEL_API_KEY
gcloud auth application-default login
pnpm build:schemas
pnpm --filter hfs-api smoke  # one call per candidate model id, one Parallel search
pnpm test                    # gate and splitter tests, no network
pnpm dev                     # API on :8080
pnpm --filter hfs-frontend dev   # UI on :3000 during development
```

Deploy:

```bash
gcloud run deploy hidden-force-studio --source . --region us-central1 \
  --allow-unauthenticated --timeout 3600 --cpu 2 --memory 2Gi \
  --min-instances 1 --no-cpu-throttling \
  --set-env-vars "GOOGLE_CLOUD_PROJECT=$GOOGLE_CLOUD_PROJECT,GOOGLE_CLOUD_LOCATION=us-central1,GOOGLE_GENAI_USE_VERTEXAI=1,OUTPUT_BUCKET=$BUCKET" \
  --set-secrets "PARALLEL_API_KEY=parallel-api-key:latest"
```

## Sample output

Committed runs live under `outputs/`. Each folder has `screenplay.fountain`, `beat_sheet.md`, `portrayal_rubric.json`, `review_history.json`, `art_brief.json`, `one_sheet.md`, and `run_manifest.json`. One folder is a deliberate HALT: `bibles/maya_adversarial.json` is written to end with the character walking, and the gate refuses it.

## What this is not

- HF1 and HF3 are model judgements. Mitigated by a separate review model at temperature zero and verbatim evidence, not eliminated.
- Rubric quality depends on what Parallel returns. Both source pools are visible so a human can judge.
- The consistency hash proves the locked paragraph never changed. There are no images in the core pipeline.
- The gate can over-refuse. That is the direction to err in.
- Run state is in memory. Every run is also written to disk and to the bucket.

## Licences

Code: MIT, see [LICENSE](LICENSE). The character bibles and generated scripts are pre-existing creative work included for evaluation, licensed CC BY-NC-ND 4.0, see [bibles/LICENSE-CONTENT](bibles/LICENSE-CONTENT).
