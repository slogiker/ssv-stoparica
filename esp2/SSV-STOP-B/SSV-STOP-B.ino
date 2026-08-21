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
#define SERVICE_UUID        "35dfc2f7-cb29-467c-9e4c-3ac0aee2ea4b"
#define CHARACTERISTIC_UUID "428e5e0b-8077-49e3-91bd-1b7e4effaa35"
#define DEVICE_NAME         "SSV-STOP-B"

#define BTN_PIN     0    // stop button — press pulls LOW (INPUT_PULLUP)
#define LED_PIN     2    // button built-in LED (GPIO 2)

// LED wiring polarity:
// Set to true if LED anode is on GPIO 2 (Active-HIGH)
// Set to false if LED cathode is on GPIO 2 (Active-LOW)
#define LED_ACTIVE_HIGH true

// Press feedback effect duration
#define PRESS_EFFECT_MS 500

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
static   uint32_t lockoutUntil = 0;       // lockout window to prevent button bounce double-triggers
static   uint32_t lastActiveTime = 0;     // auto deep sleep on connection inactivity
#define  SLEEP_TIMEOUT_MS 180000          // 3 minutes before entering deep sleep

// Software button debounce
bool     btnRaw        = HIGH;
bool     btnStable     = HIGH;
uint32_t debounceStart = 0;
#define  DEBOUNCE_MS   30

// LED juice effects (heartbeat advertising, breathing ready, strobe on press)
enum LedMode {
  LED_MODE_ADVERTISING,
  LED_MODE_CONNECTED,
  LED_MODE_PRESSED
};

LedMode  currentLedMode   = LED_MODE_ADVERTISING;
uint32_t pressEffectStart = 0;

void setLedBrightness(uint8_t duty) {
  if (LED_ACTIVE_HIGH) {
    analogWrite(LED_PIN, duty);
  } else {
    analogWrite(LED_PIN, 255 - duty);
  }
}

void setLedMode(LedMode mode) {
  currentLedMode = mode;
  if (mode == LED_MODE_PRESSED) {
    pressEffectStart = millis();
  }
}

void updateLed() {
  uint32_t now = millis();

  // 1. Strobe override when button is pressed (gives instant visual confirmation)
  if (currentLedMode == LED_MODE_PRESSED) {
    uint32_t elapsed = now - pressEffectStart;
    if (elapsed < PRESS_EFFECT_MS) {
      // Strobe toggle every 25ms (~20Hz frequency)
      bool strobeOn = (elapsed / 25) % 2 == 0;
      setLedBrightness(strobeOn ? 255 : 0);
      return;
    } else {
      // Revert to correct state based on current connection
      if (deviceConnected) {
        setLedMode(LED_MODE_CONNECTED);
      } else {
        setLedMode(LED_MODE_ADVERTISING);
      }
    }
  }

  // 2. Normal operational patterns
  if (currentLedMode == LED_MODE_CONNECTED) {
    // Breathing pattern: 2-second period
    float angle = (2 * PI * (now % 2000)) / 2000.0;
    // Map sine wave [-1, 1] to [15, 255] (low end stays slightly glowing)
    uint8_t brightness = 15 + 120 * (sin(angle) + 1.0);
    setLedBrightness(brightness);
  } 
  else if (currentLedMode == LED_MODE_ADVERTISING) {
    // Heartbeat double-blink pattern: 1-second period
    uint32_t cycleTime = now % 1000;
    if (cycleTime < 100) {
      setLedBrightness(255); // 1st pulse
    } else if (cycleTime < 200) {
      setLedBrightness(0);
    } else if (cycleTime < 300) {
      setLedBrightness(255); // 2nd pulse
    } else {
      setLedBrightness(0);   // pause
    }
  }
}

// ── BLE callbacks ────────────────────────────────────────────────────────────
class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* s, esp_ble_gatts_cb_param_t* param) override {
    deviceConnected  = true;
    pendingReconnect = false;
    reconnectAt      = 0;
    setLedMode(LED_MODE_CONNECTED);
    Serial.println("[BLE] Connected");
    // Phase 2: increase supervision timeout to 6 s (600 × 10 ms).
    // Default ~720 ms is too aggressive for gymnasium RF environments —
    // brief interference causes false disconnects. 6 s gives the link
    // time to recover without dropping.
    esp_ble_conn_update_params_t params = {};
    memcpy(params.bda, param->connect.remote_bda, 6);
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
  setCpuFrequencyMhz(80); // Lower clock frequency to 80MHz to save ~50% battery
  Serial.begin(115200);

  // LED on immediately — power indicator
  pinMode(LED_PIN, OUTPUT);
  setLedBrightness(255);

  pinMode(BTN_PIN, INPUT_PULLUP);
  lastActiveTime = millis();

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
    BLECharacteristic::PROPERTY_NOTIFY |
    BLECharacteristic::PROPERTY_READ |
    BLECharacteristic::PROPERTY_WRITE
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

  if (deviceConnected) {
    lastActiveTime = now;
  } else if (now - lastActiveTime >= SLEEP_TIMEOUT_MS) {
    Serial.println("[SYSTEM] Inactivity timeout. Entering deep sleep...");
    setLedBrightness(0); // Turn off LED
    // Wake up on BTN_PIN (GPIO 0) going LOW (0)
    esp_sleep_enable_ext0_wakeup((gpio_num_t)BTN_PIN, 0);
    esp_deep_sleep_start();
  }

  // Phase 2: non-blocking reconnect — schedule re-advertise 200ms from now instead of
  // blocking with delay(200). This keeps loop() running so button presses are not missed.
  if (pendingReconnect && reconnectAt == 0) {
    reconnectAt = millis() + 200;  // schedule for 200ms from now
  }
  if (reconnectAt > 0 && millis() >= reconnectAt) {
    pendingReconnect = false;
    reconnectAt = 0;
    pAdvertising->start();
    setLedMode(LED_MODE_ADVERTISING);
    Serial.println("[BLE] Re-advertising...");
  }

  // Update LED effects (breathing, heartbeat, or strobe)
  updateLed();

  // Button: software debounce — detect HIGH→LOW edge only
  bool raw = digitalRead(BTN_PIN);
  if (raw != btnRaw) {
    btnRaw        = raw;
    debounceStart = now;
  }
  if ((now - debounceStart) >= DEBOUNCE_MS && btnRaw != btnStable) {
    btnStable = btnRaw;
    if (btnStable == LOW) {
      if (now >= lockoutUntil) {
        lockoutUntil = now + 1000; // 1-second lockout window to prevent false double-clicks
        setLedMode(LED_MODE_PRESSED);
        if (deviceConnected) {
          uint8_t val = 0x01;
          pCharacteristic->setValue(&val, 1);
          // Send 3 times in rapid succession to guarantee delivery under heavy RF noise
          pCharacteristic->notify();
          pCharacteristic->notify();
          pCharacteristic->notify();
          Serial.println("[SSV] Stop signal sent (0x01)");
        } else {
          Serial.println("[SSV] Button pressed (offline diagnostic)");
        }
      }
    }
  }

  delay(5);   // ~200 Hz loop — responsive debounce, low CPU load
}
