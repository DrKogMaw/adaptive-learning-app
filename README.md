# Adaptive Learning Engine — milestone 1

This is a runnable curriculum and recommendation prototype for introductory JavaScript. From this folder, run `node serve.mjs`, then open the local URL it prints. Progress is saved in that browser's local storage. With the .NET 10 SDK, run `dotnet run --project api/NextStep.Api.csproj --urls http://127.0.0.1:5080` to serve the same app and score checks through the API.

## What works

- A graph of 20 learning objectives, each with an activity, duration, and prerequisites.
- Prerequisite validation and a transparent baseline recommendation that uses topic status, goal, and available time.
- Learner control: mark topics as new, practicing, or confident; override the suggested topic; reset local progress.
- A study cycle for each of the six foundation topics: four item precheck, recorded study interval, four different immediate items, and four different delayed items due after 24 hours.
- Results include item level answers and response times. The local .NET API serves answer free forms and scores submitted attempts. Sessions can resume after a browser reload.
- No cognitive diagnosis or measured mastery is claimed. Learner status is self reported and is labeled as such.

## Next milestones

1. Implement consent, accounts, and PostgreSQL persistence using `schema.sql` as the starting model. The current .NET endpoint is stateless; the browser keeps sessions and attempts locally.
2. Add four short browser cognitive tasks, a state questionnaire, trial timing, versioning, and practice baselines.
3. Evaluate the item forms and baseline recommendation policy before introducing state aware recommendations or an uncertainty aware mastery estimate.

## Data note

This prototype stores attempts and study sessions only on the current device. Delayed reviews appear when the app is opened after the due time; there are no notifications. The study clock records elapsed wall time, including interruptions, and learners may finish before the target duration. The hosted static preview includes answer keys in browser assets, and the items are not calibrated, so raw pre/post differences are not a validated learning gain. Use this for product review rather than a participant study until consent, authentication, server persistence, privacy controls, and measurement quality work are complete.
