# TrainLog

A fully custom workout tracker — build your own exercises, routines, and weekly
schedule, log effort (even partial/tapped-out sessions), and track a streak +
consistency score. Works offline once installed. No account, no server — all
data lives on your phone.

## Get it on your phone (Vivo / any Android, ~2 minutes)

The easiest free way to host it so it installs properly:

1. Go to https://github.com and create a free account if you don't have one.
2. Create a new repository (name it anything, e.g. `trainlog`), and upload
   all the files in this folder (`index.html`, `style.css`, `app.js`,
   `manifest.json`, `sw.js`, `icon-192.png`, `icon-512.png`).
3. In the repo, go to **Settings → Pages**, set **Source** to your main
   branch, and save. GitHub gives you a URL like
   `https://yourname.github.io/trainlog/`.
4. Open that URL in Chrome on your phone.
5. Tap the **⋮ menu → Add to Home screen → Install**.

That's it — it now behaves like a normal app icon, opens full-screen, and
works without signal once it's loaded the first time.

(Netlify Drop — netlify.com/drop — works too: just drag this folder onto the
page, no account needed, and it gives you a live HTTPS link immediately.)

## How it's organized

- **Exercises** — the individual moves you do. Each has a type: Reps, Time,
  Distance, or Checklist — this decides what you log when you do it.
- **Routines** — a named set of exercises, e.g. "Morning Routine" or "Leg Day."
  Build one once, reuse it anywhere.
- **Schedule** — assign routines to days of the week, with a label like
  Morning/Evening. The same routine (e.g. "Meditation") can sit on as many
  days as you want — you're not duplicating anything.
- **Today** — shows whatever's scheduled for today. Tap Start, log each
  exercise as you go, or tap the ✕ any time to tap out early — whatever you
  logged still counts.
- **History** — your streak, a 30-day consistency %, an 8-week calendar, and
  a log of every session.

## Streak vs. consistency

- **Streak** = did you show up on scheduled days. You control how strict this
  is in History → the dropdown: fully complete the plan, show up with any
  effort at all, or hit your own minimum %.
- **Consistency %** = a rolling measure of how much of your planned volume
  you actually did, independent of the streak setting — so you can see the
  full picture even if your streak rule is lenient.

## Notes

- Everything is stored locally in the browser on your phone. Clearing site
  data/cache will erase it — there's no cloud backup in this version.
- If you ever want to reset, clearing the site's storage from Chrome's site
  settings wipes it clean.
