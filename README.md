# ⏱️ SSV Stoparica — PWA Stopwatch

A professional Progressive Web App (PWA) stopwatch designed for Slovenian firefighter **SSV** (*spajanje sesalnega voda*) competitions. This application replaces traditional hardware displays and speakers with a mobile-first, high-precision timing system.

---

## ✨ Key Features

- **🎯 High Precision:** Precision timing with centisecond resolution using `requestAnimationFrame`.
- **🔋 BLE Integration:** Seamlessly connects to wireless **ESP2** stop buttons via Web Bluetooth.
- **🔊 Official Audio:** Integrated GZS (*Gasilska zveza Slovenije*) start signals for both Summer and Winter disciplines.
- **📈 Rich Analytics:** Dynamic, responsive graphs and detailed statistics for tracking team performance.
- **📱 PWA Ready:** Installable on Android and iOS. Works offline and stays awake during competition.
- **💻 Desktop Optimized:** Full-width adaptive layout for large screens and tablets.
- **👥 Multi-User:** Personal accounts to save results, PRs, and paired BLE devices.

---

## 🚀 Quick Start (Docker)

The fastest way to get up and running is using Docker Compose.

1. **Prepare Environment:**
   ```bash
   cp .env.example .env
   # Edit .env and set a unique JWT_SECRET
   ```

2. **Launch:**
   ```bash
   docker compose up -d --build
   ```

3. **Access:**
   The application is now available at **[http://localhost:8742](http://localhost:8742)**.

---

## 🧪 Testing & Accounts

To help you explore the application immediately, the database is automatically seeded with two pre-created accounts:

### 👤 Demo User
Perfect for checking out the stats and history without having to record runs manually.
- **Login:** `test@ssv.test`
- **Password:** `test1234`
- **Data:** Pre-loaded with 50+ realistic timing results across different dates and disciplines.

---

## 🛠️ Project Structure

- `frontend/`: Vanilla JavaScript PWA (Zero frameworks for maximum performance).
- `backend/`: Node.js + Express API with SQLite persistence.
- `esp2/`: Arduino firmware for the wireless BLE stop button.
- `tools/`: Utility scripts for device provisioning and QR code generation.
- `scripts/`: Development automation tools.

---

## ⚙️ Hardware Improvements

For competition reliability, it is recommended to add a **100nF capacitor** across the ESP2 stop button pins (GPIO 0 and GND). This provides robust hardware debouncing, making the stop signal bulletproof in high-interference environments.

---

## 👨‍💻 Author

Developed with ❤️ by **[slogiker](https://github.com/slogiker)**.

*This project is built for the firefighter community to modernize training and competition workflows.*
