import { theme } from "../theme/theme";

export default function AppInput({
  value,
  onChange,
  placeholder,
  type = "text"
}) {
  return (
    <input
      type={type}
      value={value}
      placeholder={placeholder}
      onChange={onChange}
      style={{
        width: "100%",
        padding: "14px",
        fontSize: "18px",
        borderRadius: theme.radius.input,
        border: `1px solid ${theme.colors.border}`,
        background: "#0F172A",
        color: theme.colors.text,
        outline: "none",
        boxSizing: "border-box",
        marginBottom: "16px"
      }}
    />
  );
}