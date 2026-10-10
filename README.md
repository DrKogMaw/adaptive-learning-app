# Adaptive Learning Engine — milestone 1

This is a runnable curriculum and recommendation prototype for introductory JavaScript. From this folder, run `node serve.mjs`, then open the local URL it prints. Progress is saved in that browser's local storage. With the .NET 10 SDK, run `dotnet run --project api/NextStep.Api.csproj --urls http://127.0.0.1:5080` to serve the same app and score checks through the API.

## What works

- A graph of 20 learning objectives, each with an activity, duration, and prerequisites.
- Prerequisite validation and a transparent baseline recommendation that uses topic status, goal, and available time.
- Learner control: mark topics as new, practicing, or confident; override the suggested topic; reset local progress.
- Four question knowledge checks for the six foundation topics. Results include item level answers and response times. The local .NET API serves answer free items and scores submitted attempts.
- No cognitive diagnosis or measured mastery is claimed. Learner status is self reported and is labeled as such.

## Next milestones

1. Add alternate item forms, pretests, posttests, and delayed retention. Replace self reported status with an uncertainty aware knowledge estimate only after the items have been evaluated.
2. Add four short browser cognitive tasks, a state questionnaire, trial timing, versioning, and practice baselines.
3. Implement consent, accounts, and PostgreSQL persistence using `schema.sql` as the starting model. The current .NET endpoint is stateless; the browser keeps attempts locally.
4. Add study sessions, then evaluate the baseline policy before introducing state aware recommendations.

## Data note

This prototype stores attempts only on the current device. The hosted static preview includes its answer key in a browser asset; it is suitable for product review, not secure assessment. It should not be used for a study or participant data until consent, authentication, server persistence, privacy controls, alternate items, and assessment instrumentation are implemented.
