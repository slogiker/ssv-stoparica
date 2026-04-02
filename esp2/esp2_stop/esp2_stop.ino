// SSV Stoparica — ESP2 Stop Button Firmware
// Target: ESP32 WROOM-32U (external antenna)
// Function: BLE peripheral, sends 0x01 notify on button press (HIGH→LOW edge)
//
// TODO: Phase 1 implementation
// - Define SERVICE_UUID and CHARACTERISTIC_UUID (unique per device, set before flashing)
// - BLE server setup with notify characteristic
// - Edge detection loop (HIGH→LOW only, debounce 50ms)
// - Battery level via standard BLE Battery Service (0x180F)

#include <BLEDevice.h>
#include <BLEServer.h>
#include <BLEUtils.h>
#include <BLE2902.h>

// Set unique UUIDs per device before flashing
#define SERVICE_UUID        "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
#define CHARACTERISTIC_UUID "XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"
#define DEVICE_NAME         "SSV-STOP-A"

#define BTN_PIN 0  // GPIO to set per hardware design

BLEServer* pServer = nullptr;
BLECharacteristic* pCharacteristic = nullptr;
bool deviceConnected = false;
bool lastBtn = HIGH;

class ServerCallbacks : public BLEServerCallbacks {
  void onConnect(BLEServer* pServer) { deviceConnected = true; }
  void onDisconnect(BLEServer* pServer) {
    deviceConnected = false;
    // Restart advertising so phone can reconnect
    pServer->getAdvertising()->start();
  }
};

void setup() {
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

  pServer->getAdvertising()->start();
}

void loop() {
  bool btn = digitalRead(BTN_PIN);

  // Edge detection: HIGH→LOW only = exactly 1 signal per press
  if (btn == LOW && lastBtn == HIGH && deviceConnected) {
    uint8_t val = 0x01;
    pCharacteristic->setValue(&val, 1);
    pCharacteristic->notify();
    delay(50); // debounce
  }

  lastBtn = btn;
  delay(10); // ~100Hz loop
}
