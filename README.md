# Adaptive Learning Engine — milestone 1

This is a runnable curriculum and recommendation prototype for introductory programming. From this folder, run `node serve.mjs`, then open the local URL it prints. Progress is saved in that browser's local storage.

## What works

- A graph of 20 learning objectives, each with an activity, duration, and prerequisites.
- Prerequisite validation and a transparent baseline recommendation that uses topic status, goal, and available time.
- Learner control: mark topics as new, practicing, or confident; override the suggested topic; reset local progress.
- No cognitive diagnosis or measured mastery is claimed. Learner status is self reported and is labeled as such.

## Next milestones

1. Add item level pretests and posttests, then replace self reported status with an uncertainty aware knowledge estimate.
2. Add four short browser cognitive tasks, a state questionnaire, trial timing, versioning, and practice baselines.
3. Implement consent, accounts, a .NET API, and PostgreSQL using `schema.sql` as the starting model. The SDK is not installed in this environment, so this milestone runs fully in the browser.
4. Add study sessions and delayed retention, then evaluate the baseline policy before introducing state aware recommendations.

## Data note

This prototype stores data only on the current device. It should not be used for a study or for collecting participant data until consent, authentication, server persistence, privacy controls, and assessment instrumentation are implemented.
