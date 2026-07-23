import { CUSTOM_FIELD_MAP, USER_FIELDS } from "./field-mapping";

interface ClickUpCustomField {
    id: string;
    name: string;
    type: string;
    value: any;
    type_config?: {
        options?: Array<{ id: string; name: string; orderindex: number }>;
    };
}

export function parseCustomFieldValue(
    field: ClickUpCustomField,
    mapping: { dbColumn: string; type: string; parseAs: string }
): any {
    if (field.value === null || field.value === undefined) return null;

    switch (mapping.parseAs) {
        case "user_id":
            // value is an array of user objects: [{ id: 94850114, username: "...", ... }]
            if (Array.isArray(field.value) && field.value.length > 0) {
                return field.value[0].id; // ClickUp user ID (number)
            }
            return null;

        case "dropdown_name":
            // value is the orderindex (number) of the selected option
            if (typeof field.value === "number" && field.type_config?.options) {
                const option = field.type_config.options.find(
                    (opt) => opt.orderindex === field.value
                );
                return option?.name || null;
            }
            return null;

        case "dropdown_name_as_decimal":
            if (typeof field.value === "number" && field.type_config?.options) {
                const option = field.type_config.options.find(
                    (opt) => opt.orderindex === field.value
                );
                return option?.name ? parseFloat(option.name) : null;
            }
            return null;

        case "string":
            return String(field.value);

        case "integer":
            return parseInt(String(field.value), 10);

        case "decimal":
            return parseFloat(String(field.value));

        case "timestamp":
            // ClickUp dates are Unix timestamps in MILLISECONDS
            const ts = parseInt(String(field.value), 10);
            return isNaN(ts) ? null : new Date(ts);

        default:
            return field.value;
    }
}

export interface ParsedCustomFields {
    [key: string]: any;
}

export function parseCustomFields(
    customFields: ClickUpCustomField[]
): ParsedCustomFields {
    const result: ParsedCustomFields = {};

    if (!customFields || !Array.isArray(customFields)) return result;

    for (const field of customFields) {
        const mapping = CUSTOM_FIELD_MAP[field.id];
        if (!mapping) continue;

        const value = parseCustomFieldValue(field, mapping);
        if (value !== null && value !== undefined) {
            result[mapping.dbColumn] = value;
        }
    }

    return result;
}
