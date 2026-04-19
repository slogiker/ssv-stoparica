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

// SERVICE_UUID is unique per device — replaced by gen_esp.py
// CHARACTERISTIC_UUID is unique per device — both UUIDs are replaced by gen_esp.py at provisioning time
#define SERVICE_UUID        "00000000-0000-0000-0000-000000000000"
#define CHARACTERISTIC_UUID "12345678-1234-1234-1234-123456789abc"
#define DEVICE_NAME         "SSV-STOP-X"

#define BTN_PIN     0    // stop button — press pulls LOW (INPUT_PULLUP)
#define LED_PIN     2    // onboard LED — HIGH = on

// LED blink interval while advertising (ms). Solid when connected.
#define BLINK_MS    500

BLEServer*         pServer         = nullptr;
BLECharacteristic* pCharacteristic = nullptr;
BLEAdvertising*    pAdvertising    = nullptr;

// volatile: written from BLE callback task, read from loop() — prevents compiler register-caching
volatile bool deviceConnected  = false;
volatile bool pendingReconnect = false;   // set in callback, handled in loop() to avoid BLE stack re-entry

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
  void onConnect(BLEServer*) override {
    deviceConnected  = true;
    pendingReconnect = false;
    digitalWrite(LED_PIN, HIGH);   // solid on when phone is connected
    Serial.println("[BLE] Connected");
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
  pAdvertising->start();

  Serial.println("[SSV] " DEVICE_NAME " ready — advertising");
}

// ── Loop ─────────────────────────────────────────────────────────────────────
void loop() {
  uint32_t now = millis();

  // Restart advertising after disconnect (handled here, not in callback,
  // to avoid calling BLE stack functions inside a BLE callback)
  if (pendingReconnect) {
    pendingReconnect = false;
    delay(200);                    // brief pause prevents rapid re-advertising loop
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
