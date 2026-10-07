# Security and configuration

## Local operation

The default client configuration uses only the `demo-sweetcherry` Firebase project and loopback Auth, Firestore, Storage and Functions emulators. Emulator mode refuses a project ID without the `demo-` prefix.

The demo seed scripts require local emulator hosts before writing. Accounts, names, phone numbers and passwords are fictional fixtures. Seed commands reset the named demo project, so they should be used only with disposable local emulator data.

Demo ports are Auth 9219, Firestore 8280, Storage 9399 and Functions 5101. Rules tests use a separate Firestore port 8580 and Storage port 9699. All Firebase emulator hosts bind to 127.0.0.1.

Public weather services can still receive requests during a local demo. Firebase production resources are not required.

## Production configuration

A Firebase web API key identifies a client project and is not a server secret. Firestore rules, Storage rules and callable authorization protect application data.

Server provider credentials, service-account keys, device credentials and local environment files are private. Keep them outside Git. OpenAI and ElevenLabs credentials belong in Firebase Functions secrets, never browser variables. Optional Functions emulator secrets belong in the ignored `functions/.secret.local` file.

Changing client configuration does not deploy rules or Functions. Review and deploy the matching rules, indexes and Functions deliberately when configuring a real project.

## Repository hygiene

The publishable repository starts with fresh Git history. Previous history and private working materials are archived outside the project. They are not part of the new remote.

`npm run check:secrets` checks tracked and eligible untracked text files for selected secret patterns and private environment files. `npm run check:history` also checks every commit. These checks deliberately report paths and categories rather than credential values. A pattern check cannot prove that every possible vendor credential is absent.

Synthetic market workbooks have no real personal records. Private market data and downloaded training datasets should remain under ignored local directories unless their owner has explicitly authorised redistribution.

## Supported behavior and limits

Registration defaults to closed. Experts require approval. Administrative account actions and case claiming require server-side authorization. The rules and callable tests exercise permitted and denied access against disposable emulators.

Photo diagnoses are manually reviewed. Simulation metrics and unverified classifier performance must not be described as measured production accuracy. The bundled classifier's provenance and evaluation limits are in `MODEL_CARDS.md`.

The retired legacy forecast Functions should not be deleted from an existing live project incidentally. A production deployment must review that export difference before confirming deletion.

No production deployment, credential rotation, account migration, remote repository creation or GitHub push is part of local project preparation.
