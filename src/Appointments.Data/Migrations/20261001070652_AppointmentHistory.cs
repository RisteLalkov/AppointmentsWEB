using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Appointments.Data.Migrations
{
    /// <inheritdoc />
    public partial class AppointmentHistory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "AppointmentHistory",
                columns: table => new
                {
                    Id = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    AppointmentId = table.Column<string>(type: "character varying(64)", nullable: false),
                    AppointmentVersion = table.Column<int>(type: "integer", nullable: false),
                    Kind = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    ActorId = table.Column<string>(type: "character varying(64)", maxLength: 64, nullable: false),
                    ActorName = table.Column<string>(type: "character varying(200)", maxLength: 200, nullable: false),
                    ActorRole = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    OccurredAt = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    BeforeStart = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    BeforeEnd = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: true),
                    BeforeStatus = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: true),
                    AfterStart = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    AfterEnd = table.Column<DateTimeOffset>(type: "timestamp with time zone", nullable: false),
                    AfterStatus = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_AppointmentHistory", x => x.Id);
                    table.CheckConstraint("CK_History_AfterRange", "\"AfterStart\" < \"AfterEnd\"");
                    table.CheckConstraint("CK_History_Before", "(\"Kind\" = 'Created' AND \"BeforeStart\" IS NULL AND \"BeforeEnd\" IS NULL AND \"BeforeStatus\" IS NULL) OR (\"Kind\" <> 'Created' AND \"BeforeStart\" IS NOT NULL AND \"BeforeEnd\" IS NOT NULL AND \"BeforeStart\" < \"BeforeEnd\" AND \"BeforeStatus\" IS NOT NULL)");
                    table.CheckConstraint("CK_History_Version", "\"AppointmentVersion\" > 0");
                    table.ForeignKey(
                        name: "FK_AppointmentHistory_Appointments_AppointmentId",
                        column: x => x.AppointmentId,
                        principalTable: "Appointments",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_AppointmentHistory_AppointmentId_AppointmentVersion",
                table: "AppointmentHistory",
                columns: new[] { "AppointmentId", "AppointmentVersion" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "AppointmentHistory");
        }
    }
}
