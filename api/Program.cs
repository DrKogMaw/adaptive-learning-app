using System.Text.Json;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

var distPath = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "..", "dist"));
var jsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web);
var bank = JsonSerializer.Deserialize<QuestionBank>(File.ReadAllText(Path.Combine(distPath, "questions.json")), jsonOptions)
    ?? throw new InvalidOperationException("Knowledge check bank is empty.");
var studyForms = JsonSerializer.Deserialize<StudyFormBank>(File.ReadAllText(Path.Combine(distPath, "study-forms.json")), jsonOptions)
    ?? throw new InvalidOperationException("Study forms are empty.");
var checks = bank.Checks.ToDictionary(check => check.TopicId, StringComparer.Ordinal);
var forms = studyForms.Forms.ToDictionary(form => form.TopicId, StringComparer.Ordinal);

app.MapGet("/api/health", () => Results.Ok(new { service = "nextstep-api", bankVersion = bank.Version, studyVersion = studyForms.Version }));

app.MapGet("/api/knowledge-checks/{topicId}", (string topicId) => GetCheck(topicId, "diagnostic"));
app.MapGet("/api/knowledge-checks/{topicId}/{form}", (string topicId, string form) => GetCheck(topicId, form));
app.MapPost("/api/knowledge-checks/{topicId}/submit", (string topicId, QuizSubmission submission) => ScoreCheck(topicId, "diagnostic", submission));
app.MapPost("/api/knowledge-checks/{topicId}/{form}/submit", (string topicId, string form, QuizSubmission submission) => ScoreCheck(topicId, form, submission));

(List<KnowledgeItem>? Items, string? Version) Resolve(string topicId, string form)
{
    if (!checks.TryGetValue(topicId, out var check)) return (null, null);
    if (form is "diagnostic" or "pre") return (check.Items, bank.Version);
    if (!forms.TryGetValue(topicId, out var studyForm)) return (null, null);
    return form switch
    {
        "post" => (studyForm.Post, studyForms.Version),
        "delayed" => (studyForm.Delayed, studyForms.Version),
        _ => (null, null)
    };
}

IResult GetCheck(string topicId, string form)
{
    var (items, version) = Resolve(topicId, form);
    if (items is null) return Results.NotFound();
    return Results.Ok(new
    {
        bankVersion = version,
        topicId,
        form,
        items = items.Select(item => new { item.Id, item.Prompt, item.Code, item.Options })
    });
}

IResult ScoreCheck(string topicId, string form, QuizSubmission submission)
{
    var (items, version) = Resolve(topicId, form);
    if (items is null) return Results.NotFound();
    if (submission.BankVersion != version) return Results.BadRequest(new { error = "Bank version mismatch." });
    if (submission.Responses is null || submission.Responses.Count != items.Count ||
        submission.Responses.Select(answer => answer.ItemId).Distinct(StringComparer.Ordinal).Count() != items.Count)
        return Results.BadRequest(new { error = "One response per item is required." });

    var byId = submission.Responses.ToDictionary(answer => answer.ItemId, StringComparer.Ordinal);
    if (items.Any(item => !byId.TryGetValue(item.Id, out var answer) ||
        answer.SelectedIndex < 0 || answer.SelectedIndex >= item.Options.Count || answer.ResponseTimeMs < 0))
        return Results.BadRequest(new { error = "Invalid item response." });

    var results = items.Select(item =>
    {
        var answer = byId[item.Id];
        return new
        {
            itemId = item.Id,
            selectedIndex = answer.SelectedIndex,
            correctIndex = item.CorrectIndex,
            isCorrect = answer.SelectedIndex == item.CorrectIndex,
            explanation = item.Explanation
        };
    }).ToArray();
    return Results.Ok(new { correct = results.Count(result => result.isCorrect), total = results.Length, items = results });
}

var fileProvider = new PhysicalFileProvider(distPath);
app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = fileProvider });
app.UseStaticFiles(new StaticFileOptions { FileProvider = fileProvider });

app.Run();

record QuestionBank(string Version, List<KnowledgeCheck> Checks);
record KnowledgeCheck(string TopicId, List<KnowledgeItem> Items);
record StudyFormBank(string Version, List<StudyForm> Forms);
record StudyForm(string TopicId, List<KnowledgeItem> Post, List<KnowledgeItem> Delayed);
record KnowledgeItem(string Id, string Prompt, string? Code, List<string> Options, int CorrectIndex, string Explanation);
record QuizSubmission(string BankVersion, List<QuizAnswer>? Responses);
record QuizAnswer(string ItemId, int SelectedIndex, int ResponseTimeMs, DateTimeOffset AnsweredAt);
