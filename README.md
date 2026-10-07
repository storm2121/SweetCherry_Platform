# SweetCherry Agricultural Platform

A React and Firebase platform for cherry growers, agricultural experts and administrators. It combines expert-reviewed leaf photos, market-price reporting, forecast workbooks, regional weather and farmer conversations.

The public pages support French, English and Arabic. Farmer, expert and admin workspaces currently use Arabic. The bundled six-class leaf classifier is available to administrators for testing. Farmers receive diagnoses from expert review.

## Start the local demo

Use Node.js 22.12 or later, Java 21, and Firebase CLI 14.26.0. Python 3.11 is needed only for forecasting and model development.

```sh
npm ci
npm run setup
npm run demo
```

The demo command starts Auth, Firestore, Storage and Functions emulators, creates fictional accounts, imports the synthetic forecast sample and starts Vite. It uses the isolated `demo-sweetcherry` project.

Open [the public app](http://127.0.0.1:5289/) or one of these workspaces:

| Workspace | Preview URL |
| --- | --- |
| Farmer | `http://127.0.0.1:5289/dev/emulator-preview.html?as=farmerA` |
| Expert | `http://127.0.0.1:5289/dev/emulator-preview.html?as=expertA` |
| Administrator | `http://127.0.0.1:5289/dev/emulator-preview.html?as=adminA` |
| Expert awaiting approval | `http://127.0.0.1:5289/dev/emulator-preview.html?as=expertC` |

All demo passwords are `demo-pass-1234`. These credentials work only with the fictional accounts in the local emulators. Stop the demo by typing `q` and pressing Enter; this lets Windows finish emulator cleanup before the terminal exits.

Install the Firebase CLI separately if it is missing:

```sh
npm install --global firebase-tools@14.26.0
```

For frontend development against already running emulators, use `npm run dev`. The client defaults to local emulators even without an environment file. The demo launcher explicitly overrides existing local Firebase settings.

## Market data and forecasts

The regenerated market workbooks are **synthetic**. Their generator models a seasonal cherry market with grade premiums, differences between markets, changing supply, shared simulated shocks, missing observations and flagged recording errors. Every workbook identifies its assumptions, seed, version, units and data cutoff.

The example forecast is a fixed snapshot issued from an in-season cutoff of **24 May 2026**. It is demonstration data, not current market information. Reported forecasting metrics measure performance on generated data and cannot establish real-world accuracy.

See [the forecasting pipeline](forecasting/README.md), [data provenance](docs/DATA.md) and [model cards](docs/MODEL_CARDS.md) for reproduction commands, sample files and evaluation limits.

The admin upload accepts three sheets, `Grade A`, `Grade AA` and `Grade AAA`, with:

```text
Date | Market | Low (P10) | Expected (P50) | High (P90) | Horizon Type | Horizon
```

The generated examples cover `1w`–`8w`, use markets `M01`–`M03` and contain ordered, non-negative price ranges in MAD/kg. An `About` sheet carries synthetic provenance, model version, generation time and source cutoff. Upload preserves these fields and rejects an invalid workbook before writing any grade.

The app can also display existing imported medium and long-range rows. This capability does not establish a validated long-range model. The new pipeline exports short-range predictions only.

## What is implemented

- Registration and role-based account access, with expert approval and an admin-controlled registration switch.
- Leaf-photo submission, expert review, farmer-visible results and training-set manifest exports.
- Expert questions, case claiming, conversations, photos and voice messages.
- Farmer price reports and comparisons with matching forecast market, grade and date.
- Regional weather from Open-Meteo, heat/frost/rain indicators, weather caching and climate context.
- Server-side OpenAI notes and ElevenLabs speech when the corresponding Functions secrets are configured.
- Hydroponic monitoring and pump controls, with an ESP32 firmware prototype in `esp32/`.

The model registry stores candidate and publication records. Publishing a registry record does not replace the bundled browser model automatically. Classifier accuracy is not claimed because an independent held-out evaluation dataset is unavailable.

## Verify the project

```sh
npm run lint
npm test
npm run build
npm run test:rules
npm run check:secrets
npm run check:history
```

The rules tests use separate local emulator ports and a demo project. Stop an existing rules-test process before rerunning them. The GitHub workflow also runs the Python forecasting tests and the generated-workbook contract check.

See [architecture](docs/ARCHITECTURE.md), [security and configuration](docs/SECURITY.md), and [validation evidence](docs/VALIDATION.md).

## Configure your own Firebase project

Copy `.env.example` to `.env`. Set `VITE_USE_EMULATORS=false` and replace the demo Firebase web configuration with your own Firebase console values. Production mode requires explicit configuration.

Keep `OPENAI_API_KEY` and `ELEVENLABS_API_KEY` in Firebase Functions secrets. They must never use a `VITE_` prefix. Paid AI/TTS calls are optional and are not required for the seeded local demo.

Deployment is manual. Review the Functions exports and configure your own Firebase project before using the Firebase CLI. The retired `refreshPriceForecasts` and `buildPriceForecastsNow` exports were removed because the current app does not consume that legacy generated-data pipeline. Deploying against a project that still has those exports can remove the corresponding live functions.

## Publish to a new GitHub repository

This project is prepared with fresh history. Create an empty GitHub repository, then set its URL:

```sh
git remote add origin https://github.com/OWNER/NEW_REPOSITORY.git
git push -u origin main
```

Use a new empty repository so the imported project starts from the new local history. Local credentials, private datasets, previous history, dependencies and generated runtime output are excluded from the publishable files.

## Project layout

| Path | Contents |
| --- | --- |
| `src/` | React pages, services, language resources and styles |
| `public/models/cherry_multiclass/` | Bundled browser classifier and labels |
| `functions/` | Firebase callables, schedules and domain modules |
| `forecasting/` | Synthetic market generator, forecasting, backtests and examples |
| `models/` | Classifier training, conversion and verification scripts |
| `tests/` | Unit, workbook, callable and security rules tests |
| `scripts/` | Local setup, demo, fingerprinting and validation commands |
| `dev/` | Emulator workspace preview |
| `esp32/` | Device firmware prototype |
| `docs/` | Architecture, provenance, model limits and validation |

Third-party dependencies retain their own licenses. Asset provenance and model redistribution limitations are documented in `docs/DATA.md` and `docs/MODEL_CARDS.md`.
