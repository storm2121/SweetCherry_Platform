# ESP32 hydroponic firmware prototype

The sketch measures TDS on GPIO 34 and temperature with a DS18B20 on GPIO 4, and controls a pump relay through GPIO 26. Configure the Wi-Fi placeholders, device ID and your own endpoint before flashing.

Required Arduino libraries are ArduinoJson 6, OneWire and DallasTemperature, alongside the ESP32 WiFi and HTTPClient libraries.

The ingestion endpoint is a Firebase callable. A configured deployment requires an authenticated device/user request and a secure token-refresh design. The prototype sketch does not yet implement that lifecycle. Physical sensor calibration, relay isolation, disconnected readings and pump safety require hardware verification.

No real Wi-Fi credentials or production endpoint are included. This firmware has not been compiled or exercised on hardware during the repository cleanup.
