using Microsoft.EntityFrameworkCore;

// Step 4 used EnsureCreated rather than migrations. Add only the Step 5 tables to
// an existing Step 4 database; a fresh database is fully created by EF Core.
public static class SchemaUpgrade
{
    public static async Task AddCognitiveTablesAsync(AppDbContext db)
    {
        var postgres = db.Database.IsNpgsql();
        var id = postgres ? "uuid" : "TEXT";
        var time = postgres ? "timestamp with time zone" : "TEXT";
        var number = postgres ? "integer" : "INTEGER";
        var big = postgres ? "bigint" : "INTEGER";
        var boolean = postgres ? "boolean" : "INTEGER";
        var text = postgres ? "text" : "TEXT";

        // The interpolated SQL types below come only from fixed provider constants.
#pragma warning disable EF1002
        await db.Database.ExecuteSqlRawAsync($"""
            CREATE TABLE IF NOT EXISTS "CognitiveSessions" (
                "Id" {id} NOT NULL PRIMARY KEY,
                "UserId" {id} NOT NULL,
                "BatteryVersion" {text} NOT NULL,
                "Seed" {big} NOT NULL,
                "StartedAt" {time} NOT NULL,
                "CompletedAt" {time} NOT NULL,
                "InterruptionCount" {number} NOT NULL,
                "DeviceInfoJson" {text} NOT NULL
            )
            """);
        await db.Database.ExecuteSqlRawAsync($"""
            CREATE TABLE IF NOT EXISTS "CognitiveTrials" (
                "Id" {id} NOT NULL PRIMARY KEY,
                "CognitiveSessionId" {id} NOT NULL,
                "TaskType" {text} NOT NULL,
                "TaskVersion" {text} NOT NULL,
                "TrialIndex" {number} NOT NULL,
                "Condition" {text} NOT NULL,
                "StimulusJson" {text} NOT NULL,
                "ResponseJson" {text} NOT NULL,
                "IsCorrect" {boolean} NOT NULL,
                "ResponseTimeMs" {number} NULL,
                "PresentedAt" {time} NOT NULL,
                "RespondedAt" {time} NULL,
                FOREIGN KEY ("CognitiveSessionId") REFERENCES "CognitiveSessions"("Id") ON DELETE CASCADE
            )
            """);
        await db.Database.ExecuteSqlRawAsync($"""
            CREATE TABLE IF NOT EXISTS "StateQuestionnaires" (
                "Id" {id} NOT NULL PRIMARY KEY,
                "CognitiveSessionId" {id} NOT NULL UNIQUE,
                "Version" {text} NOT NULL,
                "ResponsesJson" {text} NOT NULL,
                "CompletedAt" {time} NOT NULL,
                FOREIGN KEY ("CognitiveSessionId") REFERENCES "CognitiveSessions"("Id") ON DELETE CASCADE
            )
            """);
#pragma warning restore EF1002
        await db.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS \"IX_CognitiveSessions_UserId_CompletedAt\" ON \"CognitiveSessions\" (\"UserId\", \"CompletedAt\")");
        await db.Database.ExecuteSqlRawAsync("CREATE UNIQUE INDEX IF NOT EXISTS \"IX_CognitiveTrials_CognitiveSessionId_TaskType_TrialIndex\" ON \"CognitiveTrials\" (\"CognitiveSessionId\", \"TaskType\", \"TrialIndex\")");
        await db.Database.ExecuteSqlRawAsync("CREATE UNIQUE INDEX IF NOT EXISTS \"IX_StateQuestionnaires_CognitiveSessionId\" ON \"StateQuestionnaires\" (\"CognitiveSessionId\")");
    }

    public static async Task AddRecommendationTableAsync(AppDbContext db)
    {
        var postgres = db.Database.IsNpgsql();
        var id = postgres ? "uuid" : "TEXT";
        var time = postgres ? "timestamp with time zone" : "TEXT";
        var number = postgres ? "integer" : "INTEGER";
        var real = postgres ? "double precision" : "REAL";
        var text = postgres ? "text" : "TEXT";
#pragma warning disable EF1002
        await db.Database.ExecuteSqlRawAsync($"""
            CREATE TABLE IF NOT EXISTS "Recommendations" (
                "Id" {id} NOT NULL PRIMARY KEY,
                "UserId" {id} NOT NULL,
                "CreatedAt" {time} NOT NULL,
                "Policy" {text} NOT NULL,
                "ModelVersion" {text} NOT NULL,
                "TopicId" {text} NOT NULL,
                "Priority" {number} NOT NULL,
                "SelectionProbability" {real} NOT NULL,
                "CandidateCount" {number} NOT NULL,
                "Goal" {text} NOT NULL,
                "Minutes" {number} NOT NULL,
                "ReasonsJson" {text} NOT NULL,
                "FactorsJson" {text} NOT NULL,
                "MasteryEstimate" {real} NOT NULL,
                "MasteryUncertainty" {real} NOT NULL,
                "AcceptedAt" {time} NULL
            )
            """);
#pragma warning restore EF1002
        await db.Database.ExecuteSqlRawAsync("CREATE INDEX IF NOT EXISTS \"IX_Recommendations_UserId_CreatedAt\" ON \"Recommendations\" (\"UserId\", \"CreatedAt\")");
    }
}
