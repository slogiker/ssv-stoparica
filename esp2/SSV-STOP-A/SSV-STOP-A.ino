// SSV Stoparica — ESP2 stop button
// Target: ESP32 WROOM-32U (external antenna)
//
// UUIDs and device name are replaced by tools/gen_esp.py when provisioning.
// Do NOT flash this template directly — run gen_esp.py first.
//
// Wiring:
//   GPIO 0  — stop button (to GND, INPUT_PULLUP)
//   GPIO 2  — onboard LED (status indicator)

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>
#include <esp_bt.h>          // esp_ble_tx_power_set()
#include <BLEBeacon.h>
#include <esp_gap_ble_api.h> // esp_ble_gap_update_conn_params() for supervision timeout

// SERVICE_UUID is unique per device — replaced by gen_esp.py
// CHARACTERISTIC_UUID is unique per device — both UUIDs are replaced by gen_esp.py at provisioning time
#define SERVICE_UUID        "6f765748-7973-4337-8491-e0fcc08220a9"
#define CHARACTERISTIC_UUID "9ff0ddb8-dfdb-49e0-a858-1fdb5998f4fa"
#define DEVICE_NAME         "SSV-STOP-A"

#define BTN_PIN     0    // stop button — press pulls LOW (INPUT_PULLUP)
#define LED_PIN     2    // onboard LED — HIGH = on

// LED blink interval while advertising (ms). Solid when connected.
#define BLINK_MS    500

// TX Power broadcast in advertisement (dBm at 1 m — used by app for distance estimate).
// ESP32-WROOM-32U with external antenna: calibrate by measuring RSSI at exactly 1 m.
// A good starting value is -59 dBm (typical for ESP32 at 0 dBm TX, 1 m open space).
#define TX_POWER_AT_1M  -59

BLEServer*         pServer         = nullptr;
BLECharacteristic* pCharacteristic = nullptr;
BLEAdvertising*    pAdvertising    = nullptr;

// volatile: written from BLE callback task, read from loop() — prevents compiler register-caching
volatile bool deviceConnected  = false;
volatile bool pendingReconnect = false;   // set in callback, handled in loop() to avoid BLE stack re-entry
static   uint32_t reconnectAt  = 0;       // millis() timestamp when re-advertise should fire (Phase 2)

// Software button debounce
bool     btnRaw        = HIGH;
bool     btnStable     = HIGH;
uint32_t debounceStart = 0;
#define  DEBOUNCE_MS   30

// Non-blocking LED blink
uint32_t ledLastToggle = 0;
bool     ledState      = false;

// ── BLE callbacks ────────────────────────────────────────────────────────────
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* s) override {
    deviceConnected  = true;
    pendingReconnect = false;
    reconnectAt      = 0;
    digitalWrite(LED_PIN, HIGH);   // solid on when phone is connected
    Serial.println("[BLE] Connected");
    // Phase 2: increase supervision timeout to 6 s (600 × 10 ms).
    // Default ~720 ms is too aggressive for gymnasium RF environments —
    // brief interference causes false disconnects. 6 s gives the link
    // time to recover without dropping.
    esp_ble_conn_update_params_t params = {};
    memcpy(params.bda, s->getPeerAddress().getNative(), 6);
    params.latency  = 0;
    params.max_int  = 0x12;  // 22.5 ms
    params.min_int  = 0x06;  // 7.5 ms
    params.timeout  = 600;   // 6000 ms supervision timeout (units of 10 ms)
    esp_ble_gap_update_conn_params(&params);
  }
  void onDisconnect(BLEServer*) override {
    deviceConnected  = false;
    pendingReconnect = true;       // restart advertising safely from loop()
    Serial.println("[BLE] Disconnected — will re-advertise");
  }
};

// ── Setup ────────────────────────────────────────────────────────────────────
void setup() {
  Serial.begin(115200);

  // LED on immediately — power indicator
  pinMode(LED_PIN, OUTPUT);
  digitalWrite(LED_PIN, HIGH);

  pinMode(BTN_PIN, INPUT_PULLUP);

  BLEDevice::init(DEVICE_NAME);

  // Set TX power to 0 dBm — consistent, documented reference point for distance math.
  // ESP32 supports: -12, -9, -6, -3, 0, 3, 6, 9 dBm via ESP_PWR_LVL_* constants.
  esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_ADV, ESP_PWR_LVL_P0);   // 0 dBm advertising
  esp_ble_tx_power_set(ESP_BLE_PWR_TYPE_DEFAULT, ESP_PWR_LVL_P0); // 0 dBm GATT

  pServer = BLEDevice::createServer();
  pServer->setCallbacks(new ServerCallbacks());

  BLEService* pService = pServer->createService(SERVICE_UUID);
  pCharacteristic = pService->createCharacteristic(
    CHARACTERISTIC_UUID,
    BLECharacteristic::PROPERTY_NOTIFY
  );
  pCharacteristic->addDescriptor(new BLE2902());
  pService->start();

  pAdvertising = BLEDevice::getAdvertising();
  pAdvertising->addServiceUUID(SERVICE_UUID);
  pAdvertising->setScanResponse(true);
  // Preferred connection intervals — helps iOS/Android stability
  pAdvertising->setMinPreferred(0x06);
  pAdvertising->setMaxPreferred(0x12);

  // Advertise TX Power Level (AD type 0x0A) in scan response so the app can
  // compute distance via: d = 10 ^ ((TxPowerAt1m - RSSI) / (10 * n))
  // BLEAdvertisementData lets us append raw AD structures.
  BLEAdvertisementData scanResp;
  scanResp.setName(DEVICE_NAME);
  // TX Power Level AD structure: length=2, type=0x0A, value=TX_POWER_AT_1M
  uint8_t txAdv[3] = { 0x02, 0x0A, (uint8_t)(int8_t)TX_POWER_AT_1M };
  std::string txStr((char*)txAdv, 3);
  scanResp.addData(txStr);
  pAdvertising->setScanResponseData(scanResp);

  pAdvertising->start();

  Serial.println("[SSV] " DEVICE_NAME " ready — advertising");
}

// ── Loop ─────────────────────────────────────────────────────────────────────
void loop() {
  uint32_t now = millis();

  // Phase 2: non-blocking reconnect — schedule re-advertise 200ms from now instead of
  // blocking with delay(200). This keeps loop() running so button presses are not missed.
  if (pendingReconnect && reconnectAt == 0) {
    reconnectAt = millis() + 200;  // schedule for 200ms from now
  }
  if (reconnectAt > 0 && millis() >= reconnectAt) {
    pendingReconnect = false;
    reconnectAt = 0;
    pAdvertising->start();
    Serial.println("[BLE] Re-advertising...");
  }

  // LED: solid when connected, 1 Hz blink when advertising
  if (!deviceConnected && (now - ledLastToggle >= BLINK_MS)) {
    ledLastToggle = now;
    ledState = !ledState;
    digitalWrite(LED_PIN, ledState);
  }

  // Button: software debounce — detect HIGH→LOW edge only
  bool raw = digitalRead(BTN_PIN);
  if (raw != btnRaw) {
    btnRaw        = raw;
    debounceStart = now;
  }
  if ((now - debounceStart) >= DEBOUNCE_MS && btnRaw != btnStable) {
    btnStable = btnRaw;
    if (btnStable == LOW && deviceConnected) {
      uint8_t val = 0x01;
      pCharacteristic->setValue(&val, 1);
      pCharacteristic->notify();
      Serial.println("[SSV] Stop signal sent (0x01)");
    }
  }

  delay(5);   // ~200 Hz loop — responsive debounce, low CPU load
}
