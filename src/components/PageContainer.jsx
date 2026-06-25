import { theme } from "../theme/theme";

export default function PageContainer({

  children

}) {

  return (

    <div
      style={{

        minHeight: "100vh",

        background:
          "linear-gradient(180deg,#1e1b4b,#0f172a)",

        color:
          theme.colors.text,

        maxWidth: "480px",

        margin: "0 auto",

        padding:
          theme.spacing.page

      }}
    >

      {children}

    </div>

  );

}