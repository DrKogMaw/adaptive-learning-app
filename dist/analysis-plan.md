# Next Step feasibility pilot analysis plan

Version: `pilot-analysis-1.0`  
Experiment: `feasibility-1.0`

## Purpose

This pilot evaluates whether the protocol and measurements are practical enough for a later confirmatory study. It does not test whether either recommendation policy improves learning.

## Intended pilot

- Recruit approximately 20–40 consenting participants.
- Ask each participant to complete multiple study cycles and at least three cognitive runs.
- Report participant counts, sessions per participant, completion times, missing fields, recommendation acceptance, overrides, and delayed-review completion separately by assigned policy.
- Treat all policy comparisons as descriptive. Do not report statistical significance or educational benefit from this pilot.

## Feasibility measures

1. Study-cycle completion: completed cycles divided by started cycles.
2. Immediate-pair completion: cycles with both precheck and immediate postcheck.
3. Delayed-review completion: completed delayed reviews divided by reviews that became due.
4. Recommendation uptake: accepted recommendations divided by recommendation exposures.
5. Override rate: topic override events divided by recommendation exposures.
6. Cognitive completion: completed batteries per participant and proportion reaching three runs.
7. Timing quality: median and interquartile range for study duration and cognitive task response time.
8. Measurement stability: descriptive differences between cognitive reference runs 2 and 3, by task and device category.

## Predefined quality flags

- Missing precheck, immediate postcheck, study duration, or due delayed review.
- Study duration below 5 minutes or above twice the planned duration.
- Delayed review completed outside 20–96 hours after the immediate postcheck.
- Cognitive battery version mismatch, interruption, or incomplete trial set.
- Duplicate event or assignment identifiers.
- A participant using materially different device categories across reference runs.

Keep flagged records in the raw export. Summarize how many records each rule affects before deciding whether any sensitivity analysis excludes them.

## Data freeze and reporting

- Freeze the item bank, study forms, battery, experiment, event schema, and analysis-plan versions before recruitment.
- Export and hash the frozen dataset before analysis.
- Report missingness and exclusions before outcome summaries.
- Keep participant-level identifiers out of shared analysis files.
- Do not fit a cognitive recommendation model until the pilot data-quality review is complete.

## Gate for a later study

Proceed to a powered protocol only if the team can reliably collect pre, immediate, and delayed measures; assignment probabilities remain reconstructable; device and practice effects are measurable; and the burden is acceptable. A later protocol requires research review, a retention policy, and a power analysis based on the smallest educational effect worth detecting.
