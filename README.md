# SweetCherry

Decision support for cherry growers in the Fès-Meknès region of Morocco.

SweetCherry is a web platform for cherry growers in Sefrou, Azrou, Ifrane, El Hajeb and Taounate. Growers use it to follow expected cherry prices and the weather in their zone, and to get an agronomist's opinion on photos of affected leaves and fruit.

The public site is at https://sweetcherry-4caf3.web.app.

## Growers

Growers see the expected price of cherries for each of the next eight weeks, by grade (A, AA and AAA) and by market (Casablanca, Rabat and Marrakech), with a low and a high estimate around it. They can record the prices they actually obtained and see where these fall in the forecast range.

The weather page shows current conditions and the next few days for the grower's zone, with warnings for frost, heat and rain. A climate map of the five zones shows recent temperature, rainfall, chill accumulation and drought, along with future climate scenarios.

When leaves or fruit look wrong, the grower sends a photo. An agronomist identifies the problem, judges how serious it is and says what to do. Growers can also ask a question in writing or by voice message and continue the conversation with the same expert.

## Agronomists

Expert accounts open only after the platform team has checked a proof of qualification. Experts see waiting photos and questions, claim a case and answer it with text, photos or voice messages. Photos they have reviewed can be exported, with their label, as training data for the leaf classifier.

## Platform team

Administrators approve experts, open and close registration between intakes, and remove accounts or content when needed. They publish new price forecasts by uploading a spreadsheet, which is checked before anything is saved, and they can try the leaf classifier on new photos.

## Leaf classifier

A model that runs in the browser sorts cherry leaf photos into six groups: healthy, brown spots, purple spots, powdery mildew, leaf scorch and shot hole. It is still being tested, so growers' advice always comes from an agronomist.

## Price data

The market prices and forecasts in this version are simulated. The simulator follows the Moroccan cherry season: the harvest moves from low to high altitude, grades and markets carry different prices, some years bring frost or harvest rain, and some market reports go missing. The site marks these figures as simulated. They are not observed prices, and forecast errors measured on them say nothing about accuracy on real markets.

The simulator, the forecasting code and their assumptions are in `forecasting/`. Data sources and model limits are described in [docs/DATA.md](docs/DATA.md) and [docs/MODEL_CARDS.md](docs/MODEL_CARDS.md).

## Also included

Hydroponic monitoring, with sensor readings, alerts and pump control, and a firmware prototype for an ESP32 board in `esp32/`.

The public pages are available in French, English and Arabic. The signed-in workspaces are in Arabic.

SweetCherry is built with React and Firebase (authentication, database, file storage and server functions). The leaf classifier uses TensorFlow.js, and the forecasts come from a Python pipeline.
