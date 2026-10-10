using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;

public sealed class AppUser : IdentityUser<Guid>
{
    public DateTimeOffset CreatedAt { get; set; } = DateTimeOffset.UtcNow;
}

public sealed class ConsentRecord
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid UserId { get; set; }
    public string Version { get; set; } = "";
    public DateTimeOffset AcceptedAt { get; set; }
    public DateTimeOffset? WithdrawnAt { get; set; }
}

public sealed class LearnerProfile
{
    public Guid UserId { get; set; }
    public string Goal { get; set; } = "all";
    public int Minutes { get; set; } = 25;
    public string? OverrideTopicId { get; set; }
    public string TopicStatusJson { get; set; } = "{}";
}

public sealed class StudySessionRow
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public string TopicId { get; set; } = "";
    public int PlannedMinutes { get; set; }
    public string Status { get; set; } = "";
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset? StudyStartedAt { get; set; }
    public DateTimeOffset? StudyCompletedAt { get; set; }
    public int? ActualSeconds { get; set; }
    public DateTimeOffset? DueAt { get; set; }
    public DateTimeOffset? ReviewCompletedAt { get; set; }
    public bool PriorItemExposure { get; set; }
    public Guid? PreAttemptId { get; set; }
    public Guid? PostAttemptId { get; set; }
    public Guid? DelayedAttemptId { get; set; }
}

public sealed class AssessmentAttemptRow
{
    public Guid Id { get; set; }
    public Guid UserId { get; set; }
    public Guid? StudySessionId { get; set; }
    public string TopicId { get; set; } = "";
    public string AssessmentType { get; set; } = "";
    public string BankVersion { get; set; } = "";
    public DateTimeOffset StartedAt { get; set; }
    public DateTimeOffset CompletedAt { get; set; }
    public int Correct { get; set; }
    public int Total { get; set; }
    public string ScoringSource { get; set; } = "server";
    public List<ItemResponseRow> Responses { get; set; } = [];
}

public sealed class ItemResponseRow
{
    public Guid Id { get; set; } = Guid.NewGuid();
    public Guid AttemptId { get; set; }
    public string ItemId { get; set; } = "";
    public int SelectedIndex { get; set; }
    public bool IsCorrect { get; set; }
    public int ResponseTimeMs { get; set; }
    public DateTimeOffset AnsweredAt { get; set; }
}

public sealed class AppDbContext(DbContextOptions<AppDbContext> options) : IdentityDbContext<AppUser, IdentityRole<Guid>, Guid>(options)
{
    public DbSet<ConsentRecord> Consents => Set<ConsentRecord>();
    public DbSet<LearnerProfile> LearnerProfiles => Set<LearnerProfile>();
    public DbSet<StudySessionRow> StudySessions => Set<StudySessionRow>();
    public DbSet<AssessmentAttemptRow> AssessmentAttempts => Set<AssessmentAttemptRow>();
    public DbSet<ItemResponseRow> ItemResponses => Set<ItemResponseRow>();

    protected override void OnModelCreating(ModelBuilder model)
    {
        base.OnModelCreating(model);
        model.Entity<ConsentRecord>().HasIndex(x => new { x.UserId, x.AcceptedAt });
        model.Entity<ConsentRecord>().Property(x => x.Version).HasMaxLength(40);
        model.Entity<LearnerProfile>().HasKey(x => x.UserId);
        model.Entity<LearnerProfile>().Property(x => x.Goal).HasMaxLength(20);
        model.Entity<StudySessionRow>().HasIndex(x => new { x.UserId, x.StartedAt });
        model.Entity<StudySessionRow>().Property(x => x.TopicId).HasMaxLength(100);
        model.Entity<StudySessionRow>().Property(x => x.Status).HasMaxLength(30);
        model.Entity<AssessmentAttemptRow>().HasIndex(x => new { x.UserId, x.CompletedAt });
        model.Entity<AssessmentAttemptRow>().HasOne<StudySessionRow>().WithMany().HasForeignKey(x => x.StudySessionId).OnDelete(DeleteBehavior.Cascade);
        model.Entity<AssessmentAttemptRow>().HasMany(x => x.Responses).WithOne().HasForeignKey(x => x.AttemptId).OnDelete(DeleteBehavior.Cascade);
        model.Entity<ItemResponseRow>().HasIndex(x => new { x.AttemptId, x.ItemId }).IsUnique();
    }
}
