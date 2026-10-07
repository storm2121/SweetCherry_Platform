/**
 * SweetCherry Hydroponic Monitor — ESP32 Firmware
 * ─────────────────────────────────────────────────
 * Hardware:
 *   ESP32 DevKit (ELEGOO power module at 5V/3.3V)
 *   TDS nutrient sensor  → GPIO 34 (ADC1_CH6, analog input)
 *   DS18B20 temp probe   → GPIO 4  (OneWire, 4.7kΩ pull-up to 3.3V)
 *   PN2222 transistor    → GPIO 26 (base via 1kΩ, collector → 5V pump relay)
 *
 * Libraries (install via Arduino Library Manager):
 *   WiFi.h           (built-in)
 *   HTTPClient.h     (built-in)
 *   ArduinoJson      (v6 — Benoit Blanchon)
 *   OneWire          (Paul Stoffregen)
 *   DallasTemperature (Miles Burton)
 *
 * Setup:
 *   1. Fill in WIFI_SSID, WIFI_PASS, DEVICE_ID, API_URL below.
 *   2. Flash to ESP32.
 *   3. Open Serial Monitor (115200 baud) to verify.
 */

#include <WiFi.h>
#include <HTTPClient.h>
#include <ArduinoJson.h>
#include <OneWire.h>
#include <DallasTemperature.h>

// ─── Configuration — fill these in ─────────────────────────────────────────
const char* WIFI_SSID    = "YOUR_WIFI_SSID";
const char* WIFI_PASS    = "YOUR_WIFI_PASSWORD";

// Copy Device ID from the app (Profile → Hydroponic Dashboard → معرّف الجهاز)
const char* DEVICE_ID    = "device_YOUR_USER_UID";

// Firebase Cloud Function URL (europe-west1 region example)
const char* API_URL      = "https://REGION-YOUR_PROJECT_ID.cloudfunctions.net/ingestSensorData";

// ─── Pins ────────────────────────────────────────────────────────────────────
#define TDS_PIN     34   // Analog — TDS sensor signal
#define DS18B20_PIN  4   // OneWire — DS18B20 data
#define PUMP_PIN    26   // Digital — PN2222 base (HIGH = pump ON)

// ─── Interval ────────────────────────────────────────────────────────────────
const unsigned long SEND_INTERVAL_MS = 30000;  // 30 seconds

// ─── Globals ─────────────────────────────────────────────────────────────────
OneWire oneWire(DS18B20_PIN);
DallasTemperature tempSensor(&oneWire);

bool pumpState = false;
unsigned long lastSendMs = 0;

// ─── TDS conversion ──────────────────────────────────────────────────────────
// Reference voltage: 3.3V, ADC resolution: 12-bit (0-4095)
// TDS = (133.42 * V^3 - 255.86 * V^2 + 857.39 * V) * k-value
// k-value ≈ 0.5 (adjust by calibration with known TDS solution)
float readTDS() {
  int raw = analogRead(TDS_PIN);
  float voltage = raw * 3.3f / 4095.0f;
  float tds = (133.42f * voltage * voltage * voltage
             - 255.86f * voltage * voltage
             + 857.39f * voltage) * 0.5f;
  return max(0.0f, tds);
}

// ─── Pump control ────────────────────────────────────────────────────────────
void setPump(bool on) {
  pumpState = on;
  digitalWrite(PUMP_PIN, on ? HIGH : LOW);
  Serial.printf("[PUMP] %s\n", on ? "ON" : "OFF");
}

// ─── Send data + receive pump command ────────────────────────────────────────
void sendReadings(float tds, float temperature) {
  if (WiFi.status() != WL_CONNECTED) {
    Serial.println("[WiFi] Not connected, skipping send.");
    return;
  }

  StaticJsonDocument<256> doc;
  doc["data"]["deviceId"]    = DEVICE_ID;
  doc["data"]["tds"]         = round(tds * 10) / 10.0f;
  doc["data"]["temperature"] = round(temperature * 10) / 10.0f;
  doc["data"]["pumpOn"]      = pumpState;

  String body;
  serializeJson(doc, body);

  HTTPClient http;
  http.begin(API_URL);
  http.addHeader("Content-Type", "application/json");

  int code = http.POST(body);
  if (code == 200) {
    String resp = http.getString();
    StaticJsonDocument<256> respDoc;
    if (!deserializeJson(respDoc, resp)) {
      // Check for pump command from app
      if (!respDoc["result"]["pumpCommand"].isNull()) {
        bool cmd = respDoc["result"]["pumpCommand"].as<bool>();
        if (cmd != pumpState) {
          Serial.printf("[CMD] Remote pump command: %s\n", cmd ? "ON" : "OFF");
          setPump(cmd);
        }
      }
    }
    Serial.printf("[HTTP] Sent OK — TDS: %.1f ppm, Temp: %.1f°C\n", tds, temperature);
  } else {
    Serial.printf("[HTTP] Error: %d\n", code);
  }
  http.end();
}

// ─── Setup ───────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);
  delay(500);

  pinMode(PUMP_PIN, OUTPUT);
  setPump(false);

  tempSensor.begin();

  Serial.printf("\n[BOOT] SweetCherry Hydroponic Monitor\n");
  Serial.printf("[BOOT] Device ID: %s\n", DEVICE_ID);
  Serial.printf("[BOOT] Connecting to WiFi: %s\n", WIFI_SSID);

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  int retries = 0;
  while (WiFi.status() != WL_CONNECTED && retries < 20) {
    delay(500);
    Serial.print(".");
    retries++;
  }

  if (WiFi.status() == WL_CONNECTED) {
    Serial.printf("\n[WiFi] Connected — IP: %s\n", WiFi.localIP().toString().c_str());
  } else {
    Serial.println("\n[WiFi] Failed — will retry each loop.");
  }

  // Send first reading immediately
  lastSendMs = millis() - SEND_INTERVAL_MS;
}

// ─── Loop ────────────────────────────────────────────────────────────────────
void loop() {
  unsigned long now = millis();

  if (now - lastSendMs >= SEND_INTERVAL_MS) {
    lastSendMs = now;

    // Read TDS (average of 10 samples for stability)
    float tdsSum = 0;
    for (int i = 0; i < 10; i++) {
      tdsSum += readTDS();
      delay(10);
    }
    float tds = tdsSum / 10.0f;

    // Read temperature
    tempSensor.requestTemperatures();
    float temperature = tempSensor.getTempCByIndex(0);
    if (temperature == DEVICE_DISCONNECTED_C) {
      Serial.println("[TEMP] Sensor not found!");
      temperature = -1;
    }

    Serial.printf("[READ] TDS: %.1f ppm | Temp: %.1f°C | Pump: %s\n",
                  tds, temperature, pumpState ? "ON" : "OFF");

    sendReadings(tds, temperature);
  }

  delay(100);
}
