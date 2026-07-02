# Virtual Receptionist

A full-stack virtual receptionist web application for salons and service shops. It handles phone calls via Twilio, manages appointments with technician scheduling, and provides a complete customer management interface.

## Features

| Feature | Details |
|---|---|
| 📞 Phone calls | Twilio IVR – greet callers, answer service/price questions, record appointment requests, report loyalty points |
| 📅 Appointment scheduling | Book appointments by technician availability with conflict detection; 30-min slot picker |
| 👥 Customer management | Full CRUD, search by name/phone/preferred technician, flag non-compliant clients |
| ✅ Check-in / Check-out | Lobby terminal for walk-ins and pre-booked appointments, real-time "currently in" view |
| 🏆 Loyalty points | 1 point per $1 spent; assign promotions, discount tracking |
| 📊 Statistics | Dashboard: revenue, visits, appointment counts, top customers, technician performance |
| 🔴 Client flagging | Flag/unflag clients with a reason (non-compliant, no-show, etc.) |
| 💇 Service catalog | Manage services with name, description, price, duration |
| 🛠 Technician management | Profiles, specialties, weekly availability windows |
| 📋 Call log | Automatic Twilio webhook log + manual entry |

## Tech Stack

- **Backend**: Node.js + Express
- **Database**: SQLite (via `better-sqlite3`)
- **Phone**: Twilio Programmable Voice (TwiML webhooks)
- **Frontend**: Bootstrap 5 + Vanilla JS (no build step required)

## Quick Start

### Prerequisites

- Node.js ≥ 18
- (Optional) A [Twilio account](https://www.twilio.com/) for live phone call handling

### Install

```bash
npm install
```

### Configure

```bash
cp .env.example .env
# Edit .env with your Twilio credentials and public BASE_URL
```

### Run

```bash
# Development (auto-restart on changes)
npm run dev

# Production
npm start
```

Open `http://localhost:3000` in your browser.

## Twilio Setup

1. Create a Twilio account and buy a phone number.
2. Expose your local server publicly (e.g. with [ngrok](https://ngrok.com/)):
   ```bash
   ngrok http 3000
   ```
3. In the Twilio console, set the **Voice** webhook for your number to:
   ```
   https://<your-public-url>/api/calls/incoming
   ```
   Method: `HTTP POST`

## API Reference

### Customers
| Method | Path | Description |
|---|---|---|
| GET | `/api/customers` | List/search customers (`?q=`, `?phone=`, `?technician_id=`, `?flagged=true`) |
| POST | `/api/customers` | Create customer |
| GET | `/api/customers/:id` | Get customer |
| PUT | `/api/customers/:id` | Update customer |
| DELETE | `/api/customers/:id` | Delete customer |
| POST | `/api/customers/:id/flag` | Flag client (`{ reason }`) |
| POST | `/api/customers/:id/unflag` | Remove flag |
| POST | `/api/customers/:id/points` | Add/subtract points (`{ delta }`) |
| GET | `/api/customers/:id/visits` | Visit history |
| GET | `/api/customers/:id/stats` | Activity statistics |
| GET | `/api/customers/:id/promotions` | Assigned promotions |
| POST | `/api/customers/:id/promotions` | Assign promotion |

### Appointments
| Method | Path | Description |
|---|---|---|
| GET | `/api/appointments` | List appointments (`?date=`, `?status=`, `?technician_id=`, `?customer_id=`) |
| POST | `/api/appointments` | Book appointment |
| GET | `/api/appointments/availability` | Available slots (`?technician_id=&date=&duration=`) |
| GET | `/api/appointments/:id` | Get appointment |
| PUT | `/api/appointments/:id` | Update status/notes |
| DELETE | `/api/appointments/:id` | Cancel appointment |

### Visits (Check-in/out)
| Method | Path | Description |
|---|---|---|
| GET | `/api/visits` | List visits |
| GET | `/api/visits/current` | Currently checked-in customers |
| POST | `/api/visits/checkin` | Check in customer |
| PUT | `/api/visits/:id/checkout` | Check out (records total amount and awards points) |

### Services
| Method | Path | Description |
|---|---|---|
| GET | `/api/services` | List services |
| POST | `/api/services` | Create service |
| PUT | `/api/services/:id` | Update service |
| DELETE | `/api/services/:id` | Delete service |

### Technicians
| Method | Path | Description |
|---|---|---|
| GET | `/api/technicians` | List technicians |
| POST | `/api/technicians` | Create technician |
| PUT | `/api/technicians/:id` | Update technician |
| GET | `/api/technicians/:id/availability` | Get availability |
| PUT | `/api/technicians/:id/availability` | Set availability |
| GET | `/api/technicians/:id/appointments` | Upcoming appointments |

### Statistics
| Method | Path | Description |
|---|---|---|
| GET | `/api/stats/overview` | Dashboard summary |
| GET | `/api/stats/revenue` | Revenue over time (`?period=week\|month\|year`) |
| GET | `/api/stats/customers` | Customer activity |
| GET | `/api/stats/technicians` | Technician performance |
| GET | `/api/stats/services` | Most popular services |

### Calls
| Method | Path | Description |
|---|---|---|
| POST | `/api/calls/incoming` | Twilio webhook – inbound call |
| POST | `/api/calls/menu` | Twilio webhook – IVR digit selection |
| GET | `/api/calls/logs` | Call log history |
| POST | `/api/calls/log` | Log a manual call |

## Running Tests

```bash
npm test
```

Tests use an in-memory SQLite database so they are fully isolated and leave no files on disk.

## Project Structure

```
.
├── server.js              # Express app entry point
├── database.js            # SQLite schema, seed data, db singleton
├── routes/
│   ├── customers.js       # Customer CRUD, flagging, points, promotions
│   ├── technicians.js     # Technician CRUD + availability
│   ├── services.js        # Service catalog
│   ├── appointments.js    # Scheduling + availability check
│   ├── visits.js          # Check-in / Check-out
│   ├── calls.js           # Twilio IVR webhooks + call log
│   └── stats.js           # Dashboard statistics
├── public/
│   ├── index.html         # Dashboard
│   ├── customers.html     # Customer management
│   ├── appointments.html  # Appointment scheduling
│   ├── checkin.html       # Check-in / Check-out terminal
│   ├── services.html      # Service catalog management
│   ├── technicians.html   # Technician management
│   ├── call-log.html      # Call log viewer
│   └── js/app.js          # Shared frontend utilities
├── __tests__/
│   ├── customers.test.js
│   └── appointments.test.js
├── .env.example
└── .gitignore
```

