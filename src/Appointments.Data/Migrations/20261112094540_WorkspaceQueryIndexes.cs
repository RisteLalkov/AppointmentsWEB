using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Appointments.Data.Migrations
{
    /// <inheritdoc />
    public partial class WorkspaceQueryIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Appointments_ServiceId",
                table: "Appointments");

            migrationBuilder.CreateIndex(
                name: "IX_Patients_Name_Id",
                table: "Patients",
                columns: new[] { "Name", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_Appointments_ServiceId_DoctorId",
                table: "Appointments",
                columns: new[] { "ServiceId", "DoctorId" });

            migrationBuilder.CreateIndex(
                name: "IX_Appointments_Start_Id",
                table: "Appointments",
                columns: new[] { "Start", "Id" });

            migrationBuilder.CreateIndex(
                name: "IX_Appointments_Status_Start_Id",
                table: "Appointments",
                columns: new[] { "Status", "Start", "Id" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_Patients_Name_Id",
                table: "Patients");

            migrationBuilder.DropIndex(
                name: "IX_Appointments_ServiceId_DoctorId",
                table: "Appointments");

            migrationBuilder.DropIndex(
                name: "IX_Appointments_Start_Id",
                table: "Appointments");

            migrationBuilder.DropIndex(
                name: "IX_Appointments_Status_Start_Id",
                table: "Appointments");

            migrationBuilder.CreateIndex(
                name: "IX_Appointments_ServiceId",
                table: "Appointments",
                column: "ServiceId");
        }
    }
}
