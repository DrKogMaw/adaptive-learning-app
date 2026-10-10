using System.Text.Json;

public sealed record CognitiveConfig(string BatteryVersion, string QuestionnaireVersion, List<CognitiveTaskConfig> Tasks, CognitiveBaselineConfig Baseline);
public sealed record CognitiveTaskConfig(string Type, string Version, int Trials);
public sealed record CognitiveBaselineConfig(int PracticeRuns, int ReferenceRuns);
public sealed record CognitiveSessionUpload(Guid Id, string BatteryVersion, long Seed, DateTimeOffset StartedAt,
    DateTimeOffset CompletedAt, int InterruptionCount, JsonElement DeviceInfo,
    List<CognitiveTrialUpload>? Trials, QuestionnaireUpload? Questionnaire);
public sealed record CognitiveTrialUpload(Guid Id, string TaskType, string TaskVersion, int TrialIndex, string Condition,
    JsonElement Stimulus, JsonElement Response, bool IsCorrect, int? ResponseTimeMs,
    DateTimeOffset PresentedAt, DateTimeOffset? RespondedAt);
public sealed record QuestionnaireUpload(Guid Id, string Version, JsonElement Responses, DateTimeOffset CompletedAt);

public static class CognitiveStorage
{
    public static bool TryBuildRows(List<CognitiveSessionUpload>? uploads, CognitiveConfig config, Guid userId,
        Func<DateTimeOffset, bool> validDate, out List<CognitiveSessionRow> rows, out string error)
    {
        rows = [];
        error = "Invalid cognitive session.";
        if (uploads is null || uploads.Count > 50) return false;
        var ids = new HashSet<Guid>();
        var taskMap = config.Tasks.ToDictionary(x => x.Type, StringComparer.Ordinal);
        foreach (var session in uploads)
        {
            if (session.Id == Guid.Empty || !ids.Add(session.Id) || session.BatteryVersion != config.BatteryVersion ||
                session.Seed is < 1 or > uint.MaxValue || !validDate(session.StartedAt) || !validDate(session.CompletedAt) ||
                session.CompletedAt < session.StartedAt || session.InterruptionCount is < 0 or > 20 ||
                session.DeviceInfo.ValueKind != JsonValueKind.Object || session.DeviceInfo.GetRawText().Length > 300 ||
                session.Trials is null || session.Trials.Count != config.Tasks.Sum(x => x.Trials) ||
                session.Questionnaire is null || session.Questionnaire.Id == Guid.Empty ||
                session.Questionnaire.Version != config.QuestionnaireVersion || !validDate(session.Questionnaire.CompletedAt) ||
                session.Questionnaire.CompletedAt < session.StartedAt || session.Questionnaire.CompletedAt > session.CompletedAt ||
                !ValidQuestionnaire(session.Questionnaire.Responses)) return false;

            var trialIds = new HashSet<Guid>();
            var slots = new HashSet<string>(StringComparer.Ordinal);
            var trials = new List<CognitiveTrialRow>();
            foreach (var trial in session.Trials)
            {
                if (trial is null || trial.Id == Guid.Empty || !trialIds.Add(trial.Id) || trial.TaskType is null || !taskMap.TryGetValue(trial.TaskType, out var task) ||
                    trial.TaskVersion != task.Version || trial.TrialIndex < 0 || trial.TrialIndex >= task.Trials ||
                    !slots.Add($"{trial.TaskType}:{trial.TrialIndex}") || trial.Condition is null || trial.Condition.Length > 40 ||
                    trial.Stimulus.ValueKind != JsonValueKind.Object || trial.Response.ValueKind != JsonValueKind.Object ||
                    trial.Stimulus.GetRawText().Length > 500 || trial.Response.GetRawText().Length > 300 ||
                    !validDate(trial.PresentedAt) || trial.PresentedAt < session.StartedAt || trial.PresentedAt > session.CompletedAt ||
                    (trial.RespondedAt is not null && (!validDate(trial.RespondedAt.Value) || trial.RespondedAt < trial.PresentedAt || trial.RespondedAt > session.CompletedAt)) ||
                    trial.ResponseTimeMs is < 0 or > 30000 || !TryScore(trial, out var correct))
                {
                    error = "Invalid cognitive trial.";
                    return false;
                }
                trials.Add(new CognitiveTrialRow { Id = trial.Id, CognitiveSessionId = session.Id, TaskType = trial.TaskType,
                    TaskVersion = trial.TaskVersion, TrialIndex = trial.TrialIndex, Condition = trial.Condition,
                    StimulusJson = trial.Stimulus.GetRawText(), ResponseJson = trial.Response.GetRawText(),
                    IsCorrect = correct, ResponseTimeMs = trial.ResponseTimeMs,
                    PresentedAt = trial.PresentedAt, RespondedAt = trial.RespondedAt });
            }
            var switches = trials.Where(x => x.TaskType == "task-switch").OrderBy(x => x.TrialIndex).ToList();
            for (var i = 0; i < switches.Count; i++)
            {
                var rule = JsonSerializer.Deserialize<JsonElement>(switches[i].StimulusJson).GetProperty("rule").GetString();
                var expectedCondition = i == 0 ? "first" : rule == JsonSerializer.Deserialize<JsonElement>(switches[i - 1].StimulusJson).GetProperty("rule").GetString() ? "repeat" : "switch";
                if (switches[i].Condition != expectedCondition) { error = "Invalid task switching sequence."; return false; }
            }
            var row = new CognitiveSessionRow { Id = session.Id, UserId = userId, BatteryVersion = session.BatteryVersion,
                Seed = session.Seed, StartedAt = session.StartedAt, CompletedAt = session.CompletedAt,
                InterruptionCount = session.InterruptionCount, DeviceInfoJson = session.DeviceInfo.GetRawText(), Trials = trials,
                Questionnaire = new StateQuestionnaireRow { Id = session.Questionnaire.Id, CognitiveSessionId = session.Id,
                    Version = session.Questionnaire.Version, ResponsesJson = session.Questionnaire.Responses.GetRawText(),
                    CompletedAt = session.Questionnaire.CompletedAt } };
            rows.Add(row);
        }
        error = "";
        return true;
    }

    public static object ToBrowserModel(CognitiveSessionRow x) => new
    {
        x.Id, x.BatteryVersion, x.Seed, x.StartedAt, x.CompletedAt, x.InterruptionCount,
        deviceInfo = JsonSerializer.Deserialize<JsonElement>(x.DeviceInfoJson),
        trials = x.Trials.OrderBy(t => t.TaskType).ThenBy(t => t.TrialIndex).Select(t => new
        {
            t.Id, t.TaskType, t.TaskVersion, t.TrialIndex, t.Condition,
            stimulus = JsonSerializer.Deserialize<JsonElement>(t.StimulusJson),
            response = JsonSerializer.Deserialize<JsonElement>(t.ResponseJson),
            t.IsCorrect, t.ResponseTimeMs, t.PresentedAt, t.RespondedAt
        }),
        questionnaire = x.Questionnaire is null ? null : new
        {
            x.Questionnaire.Id, x.Questionnaire.Version,
            responses = JsonSerializer.Deserialize<JsonElement>(x.Questionnaire.ResponsesJson),
            x.Questionnaire.CompletedAt
        }
    };

    private static bool ValidQuestionnaire(JsonElement value)
    {
        if (value.ValueKind != JsonValueKind.Object || value.GetRawText().Length > 500) return false;
        return Int(value, "sleepiness", 1, 5) && Int(value, "motivation", 1, 5) && Int(value, "stress", 1, 5) &&
            Int(value, "sleepHours", 0, 16) && Int(value, "recentStudyMinutes", 0, 240) &&
            Int(value, "availableMinutes", 15, 45) &&
            new[] { 15, 25, 45 }.Contains(value.GetProperty("availableMinutes").GetInt32());
    }

    private static bool TryScore(CognitiveTrialUpload trial, out bool correct)
    {
        correct = false;
        var s = trial.Stimulus;
        var r = trial.Response;
        try
        {
            switch (trial.TaskType)
            {
                case "vigilance":
                    if (!Int(s, "foreperiodMs", 1200, 2400)) return false;
                    var action = r.GetProperty("action").GetString();
                    if (action is not ("tap" or "false-start" or "timeout")) return false;
                    if (action == "tap" && (trial.ResponseTimeMs is null || trial.RespondedAt is null)) return false;
                    correct = action == "tap";
                    return trial.Condition == "target";
                case "digit-backward":
                    var digits = s.GetProperty("digits").GetString();
                    var entered = r.GetProperty("entered").GetString();
                    if (digits is null || entered is null || digits.Length is < 3 or > 6 ||
                        !digits.All(char.IsDigit) || entered.Length > 12 || !entered.All(char.IsDigit)) return false;
                    correct = entered == new string(digits.Reverse().ToArray());
                    return trial.Condition == $"length-{digits.Length}";
                case "flanker":
                    var target = s.GetProperty("target").GetString();
                    var flankers = s.GetProperty("flankers").GetString();
                    var choice = r.GetProperty("choice").GetString();
                    if (target is not ("left" or "right") || flankers is not ("left" or "right") ||
                        choice is not ("left" or "right" or "timeout")) return false;
                    correct = choice == target;
                    return trial.Condition == (target == flankers ? "congruent" : "incongruent");
                case "task-switch":
                    var rule = s.GetProperty("rule").GetString();
                    var number = s.GetProperty("number").GetInt32();
                    var answer = r.GetProperty("choice").GetString();
                    if (rule is not ("parity" or "magnitude") || number is < 1 or > 9 or 5 ||
                        answer is not ("left" or "right" or "timeout") ||
                        trial.Condition is not ("first" or "repeat" or "switch")) return false;
                    var expected = rule == "parity" ? (number % 2 == 1 ? "left" : "right") : (number < 5 ? "left" : "right");
                    correct = answer == expected;
                    return true;
                default: return false;
            }
        }
        catch (Exception e) when (e is KeyNotFoundException or InvalidOperationException or FormatException)
        {
            return false;
        }
    }

    private static bool Int(JsonElement value, string property, int min, int max) =>
        value.TryGetProperty(property, out var number) && number.ValueKind == JsonValueKind.Number &&
        number.TryGetInt32(out var result) && result >= min && result <= max;
}
