using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Appointments.Data.Migrations
{
    /// <inheritdoc />
    public partial class GlobalPatientMemberships : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "GlobalPatientId",
                table: "Accounts",
                type: "character varying(64)",
                maxLength: 64,
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_Accounts_GlobalPatientId",
                table: "Accounts",
                column: "GlobalPatientId",
                unique: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Account_GlobalPatient",
                table: "Accounts",
                sql: "\"GlobalPatientId\" IS NULL OR (\"Role\" = 'Patient' AND NOT \"IsDemo\" AND \"PasswordHash\" = '')");

            migrationBuilder.AddForeignKey(
                name: "FK_Accounts_PatientAccounts_GlobalPatientId",
                table: "Accounts",
                column: "GlobalPatientId",
                principalSchema: "careline_identity",
                principalTable: "PatientAccounts",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Accounts_PatientAccounts_GlobalPatientId",
                table: "Accounts");

            migrationBuilder.DropIndex(
                name: "IX_Accounts_GlobalPatientId",
                table: "Accounts");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Account_GlobalPatient",
                table: "Accounts");

            migrationBuilder.DropColumn(
                name: "GlobalPatientId",
                table: "Accounts");
        }
    }
}
