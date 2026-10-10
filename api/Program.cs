using System.Text.Json;
using Microsoft.Extensions.FileProviders;

var builder = WebApplication.CreateBuilder(args);
var app = builder.Build();

var distPath = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "..", "dist"));
var bankPath = Path.Combine(distPath, "questions.json");
var bank = JsonSerializer.Deserialize<QuestionBank>(File.ReadAllText(bankPath), new JsonSerializerOptions(JsonSerializerDefaults.Web))
    ?? throw new InvalidOperationException("Knowledge check bank is empty.");
var checks = bank.Checks.ToDictionary(check => check.TopicId, StringComparer.Ordinal);

app.MapGet("/api/health", () => Results.Ok(new { service = "nextstep-api", bankVersion = bank.Version }));

app.MapGet("/api/knowledge-checks/{topicId}", (string topicId) =>
{
    if (!checks.TryGetValue(topicId, out var check)) return Results.NotFound();
    return Results.Ok(new
    {
        bankVersion = bank.Version,
        topicId,
        items = check.Items.Select(item => new { item.Id, item.Prompt, item.Code, item.Options })
    });
});

app.MapPost("/api/knowledge-checks/{topicId}/submit", (string topicId, QuizSubmission submission) =>
{
    if (!checks.TryGetValue(topicId, out var check)) return Results.NotFound();
    if (submission.BankVersion != bank.Version) return Results.BadRequest(new { error = "Bank version mismatch." });
    if (submission.Responses is null || submission.Responses.Count != check.Items.Count ||
        submission.Responses.Select(answer => answer.ItemId).Distinct(StringComparer.Ordinal).Count() != check.Items.Count)
        return Results.BadRequest(new { error = "One response per item is required." });

    var byId = submission.Responses.ToDictionary(answer => answer.ItemId, StringComparer.Ordinal);
    if (check.Items.Any(item => !byId.TryGetValue(item.Id, out var answer) ||
        answer.SelectedIndex < 0 || answer.SelectedIndex >= item.Options.Count || answer.ResponseTimeMs < 0))
        return Results.BadRequest(new { error = "Invalid item response." });

    var results = check.Items.Select(item =>
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
});

var fileProvider = new PhysicalFileProvider(distPath);
app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = fileProvider });
app.UseStaticFiles(new StaticFileOptions { FileProvider = fileProvider });

app.Run();

record QuestionBank(string Version, List<KnowledgeCheck> Checks);
record KnowledgeCheck(string TopicId, List<KnowledgeItem> Items);
record KnowledgeItem(string Id, string Prompt, string? Code, List<string> Options, int CorrectIndex, string Explanation);
record QuizSubmission(string BankVersion, List<QuizAnswer>? Responses);
record QuizAnswer(string ItemId, int SelectedIndex, int ResponseTimeMs, DateTimeOffset AnsweredAt);
