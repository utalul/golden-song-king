import { theme } from "../theme/theme";

export default function PrimaryButton({

  children,

  onClick,

  color,

  disabled = false

}) {

  return (

    <button

      disabled={disabled}

      onClick={onClick}

      style={{

        width: "100%",

        padding: "14px",

        border: "none",

        cursor: "pointer",

        fontSize: "18px",

        fontWeight: "bold",

        color: "white",

        borderRadius:
          theme.radius.button,

        background:
          color ||
          theme.colors.primary,

        opacity:
          disabled ? .6 : 1

      }}

    >

      {children}

    </button>

  );

}