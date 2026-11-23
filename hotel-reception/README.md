# Hotel Reception Assistant

A front-desk app for a small hotel, published as a claude.ai page:
https://claude.ai/artifact/VFWGry5oY8LjPLPjvE2x4J

## What it does

- **Guest chat:** Claude acts as the receptionist and replies in the guest's language. It answers questions only from the hotel information. It checks availability and books rooms after the guest confirms. It also passes requests to staff (towels, repairs, wake-up calls, taxis, late check-out) and alerts staff in an emergency. Voice input and read-aloud work where the viewer supports them. Conversations are not saved.
- **Front desk:** today's arrivals and departures with check-in and check-out, a request queue (new, in progress, done), a room board with housekeeping status, and a bookings table. Checking a guest out marks the room for cleaning.
- **Hotel info:** times, Wi-Fi, breakfast, parking, facilities, policies, directions, and room types with prices and room numbers. The assistant reads everything from here.

## Data and access

Bookings, requests and room status are kept in the page's shared database on claude.ai.
- Contributors and above can read and change bookings and requests.
- Only the owner and editors can change the hotel information.
- View-only visitors see the hotel information but no guest data.

Without claude.ai (for example, opening the file directly), the page runs in basic mode. It answers common questions from the hotel information in English and keeps its data in the browser.

## Files

- `index.html`: the page source as published. The claude.ai publisher wraps it in the `<html>`, `<head>` and `<body>` tags.
