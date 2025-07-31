"use client";
import React from 'react';

interface FormField {
  type: string;
  name: string;
  placeholder?: string;
  required?: boolean;
  label: string;
  options?: { value: string; label: string }[];
}

interface FormProps {
  formFields: FormField[];
  formData: Record<string, string | string[]>;
  handleInputChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  handleSubmit: (e: React.FormEvent) => void;
}

const Form: React.FC<FormProps> = ({ formFields, formData, handleInputChange, handleSubmit }) => {
  const renderField = (field: FormField) => {
    switch (field.type) {
      case "text":
      case "email":
        return (
          <input
            type={field.type}
            name={field.name}
            value={formData[field.name] || ""}
            onChange={handleInputChange}
            className="form-input"
            placeholder={field.placeholder}
            required={field.required}
          />
        );
      case "textarea":
        return (
          <textarea
            name={field.name}
            value={formData[field.name] || ""}
            onChange={handleInputChange}
            className="form-textarea"
            placeholder={field.placeholder}
            rows={4}
            required={field.required}
          />
        );
      case "radio":
        return (
          <div className="radio-group">
            {field.options?.map((option) => (
              <label key={option.value}>
                <input
                  type="radio"
                  name={field.name}
                  value={option.value}
                  checked={formData[field.name] === option.value}
                  onChange={handleInputChange}
                />
                {option.label}
              </label>
            ))}
          </div>
        );
      case "checkbox":
        return (
          <div className="checkbox-group">
            {field.options?.map((option) => (
              <label key={option.value}>
                <input
                  type="checkbox"
                  name={field.name}
                  value={option.value}
                  checked={(formData[field.name] as string[] || []).includes(option.value)}
                  onChange={handleInputChange}
                />
                {option.label}
              </label>
            ))}
          </div>
        );
      default:
        return null;
    }
  };

  return (
    <form className="google-form" onSubmit={handleSubmit}>
      <div className="form-section">
        {formFields.map((field) => (
          <div key={field.name} className="question-container">
            <label className="question-label">
              {field.label}
            </label>
            {renderField(field)}
          </div>
        ))}
      </div>
      <div className="form-actions">
        <button type="submit" className="submit-button">
          Submit
        </button>
      </div>
    </form>
  );
};

export default Form; 