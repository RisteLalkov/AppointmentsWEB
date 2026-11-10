using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace Appointments.Data.Migrations
{
    /// <inheritdoc />
    public partial class PatientNumbers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<long>(
                name: "Number",
                table: "Patients",
                type: "bigint",
                nullable: false,
                defaultValue: 0L)
                .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn);

            migrationBuilder.CreateIndex(
                name: "IX_Patients_Number",
                table: "Patients",
                column: "Number",
                unique: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_Patient_Number",
                table: "Patients",
                sql: "\"Number\" > 0");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Patients_Number",
                table: "Patients");

            migrationBuilder.DropCheckConstraint(
                name: "CK_Patient_Number",
                table: "Patients");

            migrationBuilder.DropColumn(
                name: "Number",
                table: "Patients");
        }
    }
}
