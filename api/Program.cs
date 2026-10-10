using System.Security.Claims;
using System.Text.Json;
using Microsoft.AspNetCore.Antiforgery;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.FileProviders;

const string consentVersion = "2026-10-10-v1";
const string consentText = "Next Step stores your account email, topic choices, study session times, question answers, response times, and scores to let you resume your work across devices. The current checks are exploratory and are not a diagnosis or a validated measure of learning gain. You can withdraw consent to stop new study data being saved, export your data, or delete your account and its study data. This prototype does not share your data with other learners. Contact the app operator before using it for a formal participant study.";

var builder = WebApplication.CreateBuilder(args);
var provider = builder.Configuration["NEXTSTEP_DB_PROVIDER"]?.ToLowerInvariant() ?? "sqlite";
if (provider == "postgres")
{
    var connection = builder.Configuration.GetConnectionString("NextStep") ?? builder.Configuration["NEXTSTEP_POSTGRES_CONNECTION"];
    if (string.IsNullOrWhiteSpace(connection)) throw new InvalidOperationException("Set NEXTSTEP_POSTGRES_CONNECTION for PostgreSQL mode.");
    builder.Services.AddDbContext<AppDbContext>(options => options.UseNpgsql(connection));
}
else if (provider == "sqlite")
{
    var path = builder.Configuration["NEXTSTEP_SQLITE_PATH"] ?? Path.Combine(builder.Environment.ContentRootPath, "nextstep-dev.db");
    builder.Services.AddDbContext<AppDbContext>(options => options.UseSqlite($"Data Source={path}"));
}
else throw new InvalidOperationException("NEXTSTEP_DB_PROVIDER must be sqlite or postgres.");

builder.Services.AddAuthorization();
builder.Services.AddIdentityApiEndpoints<AppUser>(options =>
{
    options.User.RequireUniqueEmail = true;
    options.Password.RequiredLength = 10;
    options.Password.RequireNonAlphanumeric = false;
    options.SignIn.RequireConfirmedEmail = false;
}).AddEntityFrameworkStores<AppDbContext>();
builder.Services.AddAntiforgery(options => options.HeaderName = "X-CSRF-TOKEN");

var app = builder.Build();
using (var scope = app.Services.CreateScope())
    await scope.ServiceProvider.GetRequiredService<AppDbContext>().Database.EnsureCreatedAsync();

var distPath = Path.GetFullPath(Path.Combine(app.Environment.ContentRootPath, "..", "dist"));
var jsonOptions = new JsonSerializerOptions(JsonSerializerDefaults.Web);
var bank = JsonSerializer.Deserialize<QuestionBank>(File.ReadAllText(Path.Combine(distPath, "questions.json")), jsonOptions)
    ?? throw new InvalidOperationException("Knowledge check bank is empty.");
var studyForms = JsonSerializer.Deserialize<StudyFormBank>(File.ReadAllText(Path.Combine(distPath, "study-forms.json")), jsonOptions)
    ?? throw new InvalidOperationException("Study forms are empty.");
var checks = bank.Checks.ToDictionary(check => check.TopicId, StringComparer.Ordinal);
var forms = studyForms.Forms.ToDictionary(form => form.TopicId, StringComparer.Ordinal);
var topicIds = new HashSet<string>(StringComparer.Ordinal) { "cs.variables", "cs.types", "cs.operators", "cs.conditionals", "cs.loops", "cs.functions", "cs.scope", "cs.arrays", "cs.objects", "cs.strings", "cs.debugging", "cs.recursion", "cs.complexity", "cs.search", "cs.sort", "cs.recursive-trees", "cs.backtracking", "cs.dom", "cs.events", "cs.async" };

app.Use(async (context, next) =>
{
    if (HttpMethods.IsPost(context.Request.Method) || HttpMethods.IsPut(context.Request.Method) || HttpMethods.IsDelete(context.Request.Method))
    {
        var origin = context.Request.Headers.Origin.ToString();
        var expected = $"{context.Request.Scheme}://{context.Request.Host}";
        if ((!string.IsNullOrEmpty(origin) && !string.Equals(origin, expected, StringComparison.OrdinalIgnoreCase)) ||
            string.Equals(context.Request.Headers["Sec-Fetch-Site"], "cross-site", StringComparison.OrdinalIgnoreCase))
        {
            context.Response.StatusCode = StatusCodes.Status403Forbidden;
            return;
        }
    }
    await next();
});
app.UseAuthentication();
app.UseAuthorization();

app.MapGet("/api/health", () => Results.Ok(new { service = "nextstep-api", bankVersion = bank.Version, studyVersion = studyForms.Version, storage = provider }));
app.MapGroup("/api/auth").MapIdentityApi<AppUser>();
app.MapGet("/api/auth/csrf", (HttpContext context, IAntiforgery antiforgery) =>
{
    var tokens = antiforgery.GetAndStoreTokens(context);
    context.Response.Headers.CacheControl = "no-store";
    return Results.Ok(new { token = tokens.RequestToken });
});
app.MapGet("/api/auth/me", async (ClaimsPrincipal principal, AppDbContext db) =>
{
    var userId = CurrentUserId(principal);
    var user = await db.Users.FindAsync(userId);
    var active = await db.Consents.AnyAsync(x => x.UserId == userId && x.Version == consentVersion && x.WithdrawnAt == null);
    return Results.Ok(new { user!.Email, consentVersion = active ? consentVersion : null });
}).RequireAuthorization();
app.MapPost("/api/auth/logout", async (HttpContext context, IAntiforgery antiforgery) =>
{
    if (!await HasValidCsrf(context, antiforgery)) return Results.BadRequest(new { error = "Invalid CSRF token." });
    await context.SignOutAsync(IdentityConstants.ApplicationScheme);
    return Results.NoContent();
}).RequireAuthorization();

app.MapGet("/api/consent", async (ClaimsPrincipal principal, AppDbContext db) =>
{
    var userId = CurrentUserId(principal);
    var records = (await db.Consents.Where(x => x.UserId == userId).ToListAsync()).OrderByDescending(x => x.AcceptedAt).ToList();
    return Results.Ok(new { version = consentVersion, text = consentText, active = records.Any(x => x.Version == consentVersion && x.WithdrawnAt == null), history = records.Select(x => new { x.Version, x.AcceptedAt, x.WithdrawnAt }) });
}).RequireAuthorization();
app.MapPost("/api/consent", async (ConsentSubmission submission, ClaimsPrincipal principal, HttpContext context, IAntiforgery antiforgery, AppDbContext db) =>
{
    if (!await HasValidCsrf(context, antiforgery)) return Results.BadRequest(new { error = "Invalid CSRF token." });
    if (submission.Version != consentVersion || submission.Accepted != true) return Results.BadRequest(new { error = "Read and accept the current consent version." });
    var userId = CurrentUserId(principal);
    if (!await db.Consents.AnyAsync(x => x.UserId == userId && x.Version == consentVersion && x.WithdrawnAt == null))
    {
        db.Consents.Add(new ConsentRecord { UserId = userId, Version = consentVersion, AcceptedAt = DateTimeOffset.UtcNow });
        await db.SaveChangesAsync();
    }
    return Results.Ok(new { active = true, version = consentVersion });
}).RequireAuthorization();
app.MapDelete("/api/consent", async (ClaimsPrincipal principal, HttpContext context, IAntiforgery antiforgery, AppDbContext db) =>
{
    if (!await HasValidCsrf(context, antiforgery)) return Results.BadRequest(new { error = "Invalid CSRF token." });
    var userId = CurrentUserId(principal);
    var active = await db.Consents.Where(x => x.UserId == userId && x.WithdrawnAt == null).ToListAsync();
    foreach (var record in active) record.WithdrawnAt = DateTimeOffset.UtcNow;
    await db.SaveChangesAsync();
    return Results.NoContent();
}).RequireAuthorization();

app.MapGet("/api/progress", async (ClaimsPrincipal principal, AppDbContext db) =>
{
    var userId = CurrentUserId(principal);
    var profile = await db.LearnerProfiles.FindAsync(userId);
    var sessions = (await db.StudySessions.Where(x => x.UserId == userId).ToListAsync()).OrderBy(x => x.StartedAt).ToList();
    var attempts = (await db.AssessmentAttempts.Where(x => x.UserId == userId).Include(x => x.Responses).ToListAsync()).OrderBy(x => x.CompletedAt).ToList();
    return Results.Ok(new
    {
        status = profile is null ? new Dictionary<string, string>() : JsonSerializer.Deserialize<Dictionary<string, string>>(profile.TopicStatusJson)!,
        goal = profile?.Goal ?? "all", minutes = profile?.Minutes ?? 25, @override = profile?.OverrideTopicId,
        studySessions = sessions.Select(x => new { x.Id, x.TopicId, x.PlannedMinutes, x.Status, x.StartedAt, x.StudyStartedAt, x.StudyCompletedAt, x.ActualSeconds, x.DueAt, x.ReviewCompletedAt, x.PriorItemExposure, x.PreAttemptId, x.PostAttemptId, x.DelayedAttemptId }),
        attempts = attempts.Select(x => new { x.Id, x.TopicId, sessionId = x.StudySessionId, x.AssessmentType, x.BankVersion, x.StartedAt, x.CompletedAt, x.Correct, x.Total, x.ScoringSource,
            responses = x.Responses.OrderBy(r => r.AnsweredAt).Select(r => new { r.ItemId, r.SelectedIndex, r.ResponseTimeMs, r.AnsweredAt }) })
    });
}).RequireAuthorization();

app.MapPut("/api/progress", async (ProgressUpload upload, ClaimsPrincipal principal, HttpContext context, IAntiforgery antiforgery, AppDbContext db) =>
{
    if (!await HasValidCsrf(context, antiforgery)) return Results.BadRequest(new { error = "Invalid CSRF token." });
    var userId = CurrentUserId(principal);
    if (!await db.Consents.AnyAsync(x => x.UserId == userId && x.Version == consentVersion && x.WithdrawnAt == null))
        return Results.Problem("Current consent is required to save study data.", statusCode: 403);
    if (upload.Status is null || upload.Attempts is null || upload.StudySessions is null ||
        !new[] { "all", "web", "problem" }.Contains(upload.Goal) || !new[] { 15, 25, 45 }.Contains(upload.Minutes) ||
        upload.Status.Count > 20 || upload.Attempts.Count > 200 || upload.StudySessions.Count > 100 ||
        upload.Status.Any(x => !KnownTopic(x.Key) || !new[] { "new", "practicing", "confident" }.Contains(x.Value)) ||
        (upload.Override is not null && !KnownTopic(upload.Override)))
        return Results.BadRequest(new { error = "Invalid progress settings or size." });

    var sessionIds = new HashSet<Guid>();
    var sessionRows = new List<StudySessionRow>();
    foreach (var s in upload.StudySessions)
    {
        if (s.Id == Guid.Empty || !sessionIds.Add(s.Id) || !forms.ContainsKey(s.TopicId) ||
            s.PlannedMinutes < 1 || s.PlannedMinutes > 180 ||
            !new[] { "pretest", "studying", "posttest", "awaiting-review", "complete" }.Contains(s.Status) ||
            !ValidDate(s.StartedAt) || !OptionalDate(s.StudyStartedAt) || !OptionalDate(s.StudyCompletedAt) ||
            !OptionalDate(s.DueAt) || !OptionalDate(s.ReviewCompletedAt) || s.ActualSeconds is < 0 or > 86400)
            return Results.BadRequest(new { error = "Invalid study session." });
        sessionRows.Add(new StudySessionRow { Id = s.Id, UserId = userId, TopicId = s.TopicId, PlannedMinutes = s.PlannedMinutes,
            Status = s.Status, StartedAt = s.StartedAt, StudyStartedAt = s.StudyStartedAt, StudyCompletedAt = s.StudyCompletedAt,
            ActualSeconds = s.ActualSeconds, DueAt = s.DueAt, ReviewCompletedAt = s.ReviewCompletedAt,
            PriorItemExposure = s.PriorItemExposure, PreAttemptId = s.PreAttemptId, PostAttemptId = s.PostAttemptId, DelayedAttemptId = s.DelayedAttemptId });
    }

    var attemptIds = new HashSet<Guid>();
    var attemptRows = new List<AssessmentAttemptRow>();
    foreach (var a in upload.Attempts)
    {
        if (a.Id == Guid.Empty || !attemptIds.Add(a.Id) || !checks.ContainsKey(a.TopicId) ||
            a.AssessmentType is not ("diagnostic" or "pre" or "post" or "delayed") ||
            !ValidDate(a.StartedAt) || !ValidDate(a.CompletedAt) || a.CompletedAt < a.StartedAt ||
            (a.SessionId is not null && (!sessionIds.Contains(a.SessionId.Value) || sessionRows.Single(s => s.Id == a.SessionId).TopicId != a.TopicId)) ||
            (a.SessionId is null && a.AssessmentType != "diagnostic") ||
            (a.SessionId is not null && a.AssessmentType == "diagnostic"))
            return Results.BadRequest(new { error = "Invalid assessment attempt." });
        var (items, version) = Resolve(a.TopicId, a.AssessmentType);
        if (items is null || a.BankVersion != version || !ValidResponses(items, a.Responses))
            return Results.BadRequest(new { error = "Invalid or outdated assessment responses." });
        var answers = a.Responses!.ToDictionary(x => x.ItemId, StringComparer.Ordinal);
        attemptRows.Add(new AssessmentAttemptRow { Id = a.Id, UserId = userId, StudySessionId = a.SessionId,
            TopicId = a.TopicId, AssessmentType = a.AssessmentType, BankVersion = a.BankVersion,
            StartedAt = a.StartedAt, CompletedAt = a.CompletedAt, Total = items.Count,
            Correct = items.Count(item => answers[item.Id].SelectedIndex == item.CorrectIndex), ScoringSource = "server-rescored-import",
            Responses = items.Select(item => new ItemResponseRow { AttemptId = a.Id, ItemId = item.Id,
                SelectedIndex = answers[item.Id].SelectedIndex, IsCorrect = answers[item.Id].SelectedIndex == item.CorrectIndex,
                ResponseTimeMs = answers[item.Id].ResponseTimeMs, AnsweredAt = answers[item.Id].AnsweredAt }).ToList() });
    }
    if (sessionRows.Any(s => (s.PreAttemptId is not null && !Matches(s.PreAttemptId, s.Id, "pre")) ||
        (s.PostAttemptId is not null && !Matches(s.PostAttemptId, s.Id, "post")) ||
        (s.DelayedAttemptId is not null && !Matches(s.DelayedAttemptId, s.Id, "delayed"))))
        return Results.BadRequest(new { error = "Study session attempt links do not match." });
    bool Matches(Guid? attemptId, Guid sessionId, string type) => attemptRows.Any(a => a.Id == attemptId && a.StudySessionId == sessionId && a.AssessmentType == type);

    await using var transaction = await db.Database.BeginTransactionAsync();
    await db.AssessmentAttempts.Where(x => x.UserId == userId).ExecuteDeleteAsync();
    await db.StudySessions.Where(x => x.UserId == userId).ExecuteDeleteAsync();
    db.StudySessions.AddRange(sessionRows);
    db.AssessmentAttempts.AddRange(attemptRows);
    var profile = await db.LearnerProfiles.FindAsync(userId);
    if (profile is null) { profile = new LearnerProfile { UserId = userId }; db.LearnerProfiles.Add(profile); }
    profile.Goal = upload.Goal;
    profile.Minutes = upload.Minutes;
    profile.OverrideTopicId = upload.Override;
    profile.TopicStatusJson = JsonSerializer.Serialize(upload.Status);
    await db.SaveChangesAsync();
    await transaction.CommitAsync();
    return Results.Ok(new { saved = true, studySessions = sessionRows.Count, attempts = attemptRows.Count, responses = attemptRows.Sum(x => x.Responses.Count) });
}).RequireAuthorization();

app.MapDelete("/api/account", async (ClaimsPrincipal principal, HttpContext context, IAntiforgery antiforgery, AppDbContext db) =>
{
    if (!await HasValidCsrf(context, antiforgery)) return Results.BadRequest(new { error = "Invalid CSRF token." });
    var userId = CurrentUserId(principal);
    await using var transaction = await db.Database.BeginTransactionAsync();
    await db.AssessmentAttempts.Where(x => x.UserId == userId).ExecuteDeleteAsync();
    await db.StudySessions.Where(x => x.UserId == userId).ExecuteDeleteAsync();
    await db.LearnerProfiles.Where(x => x.UserId == userId).ExecuteDeleteAsync();
    await db.Consents.Where(x => x.UserId == userId).ExecuteDeleteAsync();
    var user = await db.Users.FindAsync(userId);
    if (user is not null) { db.Users.Remove(user); await db.SaveChangesAsync(); }
    await transaction.CommitAsync();
    await context.SignOutAsync(IdentityConstants.ApplicationScheme);
    return Results.NoContent();
}).RequireAuthorization();

app.MapGet("/api/knowledge-checks/{topicId}", (string topicId) => GetCheck(topicId, "diagnostic"));
app.MapGet("/api/knowledge-checks/{topicId}/{form}", (string topicId, string form) => GetCheck(topicId, form));
app.MapPost("/api/knowledge-checks/{topicId}/submit", (string topicId, QuizSubmission submission) => ScoreCheck(topicId, "diagnostic", submission));
app.MapPost("/api/knowledge-checks/{topicId}/{form}/submit", (string topicId, string form, QuizSubmission submission) => ScoreCheck(topicId, form, submission));

(List<KnowledgeItem>? Items, string? Version) Resolve(string topicId, string form)
{
    if (!checks.TryGetValue(topicId, out var check)) return (null, null);
    if (form is "diagnostic" or "pre") return (check.Items, bank.Version);
    if (!forms.TryGetValue(topicId, out var studyForm)) return (null, null);
    return form switch { "post" => (studyForm.Post, studyForms.Version), "delayed" => (studyForm.Delayed, studyForms.Version), _ => (null, null) };
}
bool KnownTopic(string id) => topicIds.Contains(id);
bool ValidDate(DateTimeOffset date) => date > new DateTimeOffset(2020, 1, 1, 0, 0, 0, TimeSpan.Zero) && date < DateTimeOffset.UtcNow.AddDays(2);
bool OptionalDate(DateTimeOffset? date) => date is null || ValidDate(date.Value);
bool ValidResponses(List<KnowledgeItem> items, List<QuizAnswer>? responses)
{
    if (responses is null || responses.Count != items.Count || responses.Select(x => x.ItemId).Distinct(StringComparer.Ordinal).Count() != items.Count) return false;
    var byId = responses.ToDictionary(x => x.ItemId, StringComparer.Ordinal);
    return items.All(item => byId.TryGetValue(item.Id, out var answer) && answer.SelectedIndex >= 0 &&
        answer.SelectedIndex < item.Options.Count && answer.ResponseTimeMs is >= 0 and <= 3600000 && ValidDate(answer.AnsweredAt));
}
IResult GetCheck(string topicId, string form)
{
    var (items, version) = Resolve(topicId, form);
    if (items is null) return Results.NotFound();
    return Results.Ok(new { bankVersion = version, topicId, form, items = items.Select(item => new { item.Id, item.Prompt, item.Code, item.Options }) });
}
IResult ScoreCheck(string topicId, string form, QuizSubmission submission)
{
    var (items, version) = Resolve(topicId, form);
    if (items is null) return Results.NotFound();
    if (submission.BankVersion != version) return Results.BadRequest(new { error = "Bank version mismatch." });
    if (!ValidResponses(items, submission.Responses)) return Results.BadRequest(new { error = "Invalid item response." });
    var byId = submission.Responses!.ToDictionary(answer => answer.ItemId, StringComparer.Ordinal);
    var results = items.Select(item => new { itemId = item.Id, selectedIndex = byId[item.Id].SelectedIndex, correctIndex = item.CorrectIndex,
        isCorrect = byId[item.Id].SelectedIndex == item.CorrectIndex, explanation = item.Explanation }).ToArray();
    return Results.Ok(new { correct = results.Count(result => result.isCorrect), total = results.Length, items = results });
}

var fileProvider = new PhysicalFileProvider(distPath);
app.UseDefaultFiles(new DefaultFilesOptions { FileProvider = fileProvider });
app.UseStaticFiles(new StaticFileOptions { FileProvider = fileProvider });
app.Run();

static Guid CurrentUserId(ClaimsPrincipal principal) => Guid.Parse(principal.FindFirstValue(ClaimTypes.NameIdentifier)!);
static async Task<bool> HasValidCsrf(HttpContext context, IAntiforgery antiforgery)
{
    try { await antiforgery.ValidateRequestAsync(context); return true; }
    catch (AntiforgeryValidationException) { return false; }
}

record QuestionBank(string Version, List<KnowledgeCheck> Checks);
record KnowledgeCheck(string TopicId, List<KnowledgeItem> Items);
record StudyFormBank(string Version, List<StudyForm> Forms);
record StudyForm(string TopicId, List<KnowledgeItem> Post, List<KnowledgeItem> Delayed);
record KnowledgeItem(string Id, string Prompt, string? Code, List<string> Options, int CorrectIndex, string Explanation);
record QuizSubmission(string BankVersion, List<QuizAnswer>? Responses);
record QuizAnswer(string ItemId, int SelectedIndex, int ResponseTimeMs, DateTimeOffset AnsweredAt);
record ConsentSubmission(string Version, bool Accepted);
record ProgressUpload(Dictionary<string, string>? Status, string Goal, int Minutes, string? Override,
    List<AttemptUpload>? Attempts, List<SessionUpload>? StudySessions);
record AttemptUpload(Guid Id, string TopicId, Guid? SessionId, string AssessmentType, string BankVersion,
    DateTimeOffset StartedAt, DateTimeOffset CompletedAt, List<QuizAnswer>? Responses);
record SessionUpload(Guid Id, string TopicId, int PlannedMinutes, string Status, DateTimeOffset StartedAt,
    DateTimeOffset? StudyStartedAt, DateTimeOffset? StudyCompletedAt, int? ActualSeconds, DateTimeOffset? DueAt,
    DateTimeOffset? ReviewCompletedAt, bool PriorItemExposure, Guid? PreAttemptId, Guid? PostAttemptId, Guid? DelayedAttemptId);
