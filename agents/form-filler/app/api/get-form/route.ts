import { NextResponse } from "next/server";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";

interface FormFieldOption {
  value: string;
  label: string;
}

interface RadioOrCheckboxField {
  type: "radio" | "checkbox";
  name: string;
  label: string;
  options: FormFieldOption[];
}

interface OtherField {
  type: string;
  name: string;
  placeholder: string;
  required: boolean;
  label: string;
}

type FormField = RadioOrCheckboxField | OtherField;

export async function GET() {
  try {
    const htmlFilePath = path.join(process.cwd(), "public", "form.html");
    const htmlContent = fs.readFileSync(htmlFilePath, "utf-8");
    const $ = cheerio.load(htmlContent);

    const formFields: FormField[] = [];

    $("input, textarea").each((_, element) => {
      const type = $(element).attr("type") || "textarea";
      const name = $(element).attr("name") || "";
      const placeholder = $(element).attr("placeholder") || "";
      const required = $(element).prop("required");
      const label = $(element).closest(".question-container").find(".question-label").text().trim();

      if (type === "radio" || type === "checkbox") {
        const existingField = formFields.find((field) => field.name === name);
        if (existingField) {
          if ("options" in existingField) {
            existingField.options.push({
              value: $(element).attr("value") || "",
              label: $(element).parent().text().trim(),
            });
          }
        } else {
          formFields.push({
            type,
            name,
            label,
            options: [
              {
                value: $(element).attr("value") || "",
                label: $(element).parent().text().trim(),
              },
            ],
          });
        }
      } else {
        formFields.push({ type, name, placeholder, required: !!required, label });
      }
    });

    return NextResponse.json(formFields);
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Failed to parse form" },
      { status: 500 }
    );
  }
} 