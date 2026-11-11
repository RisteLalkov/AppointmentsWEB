using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Appointments.Data.Migrations
{
    /// <inheritdoc />
    public partial class DatedWorkingHours : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateOnly>(
                name: "ValidFrom",
                table: "WorkingPeriods",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "ValidTo",
                table: "WorkingPeriods",
                type: "date",
                nullable: true);

            migrationBuilder.AddCheckConstraint(
                name: "CK_WorkingPeriod_Dates",
                table: "WorkingPeriods",
                sql: "(\"ValidFrom\" IS NULL AND \"ValidTo\" IS NULL) OR (\"ValidFrom\" IS NOT NULL AND \"ValidTo\" IS NOT NULL AND \"ValidFrom\" <= \"ValidTo\")");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropCheckConstraint(
                name: "CK_WorkingPeriod_Dates",
                table: "WorkingPeriods");

            migrationBuilder.DropColumn(
                name: "ValidFrom",
                table: "WorkingPeriods");

            migrationBuilder.DropColumn(
                name: "ValidTo",
                table: "WorkingPeriods");
        }
    }
}
