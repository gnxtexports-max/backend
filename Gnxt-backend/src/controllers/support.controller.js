import nodemailer from "nodemailer";

/**
 * POST /api/support/ticket
 * Sends a support email using the SMTP settings configured in .env.
 */
export const createSupportTicket = async (req, res) => {
  try {
    const { module, description, contactEmail, contactName } = req.body;

    if (!module || !description) {
      return res.status(400).json({
        success: false,
        message: "Module and issue description are required."
      });
    }

    const smtpUser = process.env.SMTP_USER || process.env.EMAIL_USER || "divyamadhuratech@gmail.com";
    const smtpPass = process.env.SMTP_PASS || process.env.EMAIL_PASSWORD;

    const logMockEmail = () => {
      console.log("\n========================================================");
      console.log("   [DEVELOPMENT MODE] MOCK EMAIL SUBMISSION SUCCESS     ");
      console.log("========================================================");
      console.log(`From:      GNXT Support Portal <${smtpUser}>`);
      console.log(`To:        support@madhuratechnologies.com`);
      console.log(`Reply-To:  ${contactEmail || smtpUser}`);
      console.log(`Subject:   [Support Ticket] Issue in ${module}`);
      console.log(`Contact:   ${contactName || "N/A"} (${contactEmail || "N/A"})`);
      console.log("------------------ MESSAGE CONTENT ---------------------");
      console.log(description);
      console.log("========================================================\n");
    };

    const isDev = process.env.NODE_ENV === "development";
    const isDummyPass = !smtpPass || smtpPass === "your_app_password_here";

    if (isDev && isDummyPass) {
      logMockEmail();
      return res.status(200).json({
        success: true,
        message: "Support ticket submitted successfully. (Dev Mode: E-mail output has been logged to the server console.)",
        isMock: true
      });
    }

    if (!smtpPass) {
      console.warn("WARNING: SMTP_PASS or EMAIL_PASSWORD is not configured in backend/.env file.");
      return res.status(500).json({
        success: false,
        message: "SMTP_PASS or EMAIL_PASSWORD is not configured in backend/.env. Please configure it to enable support emails."
      });
    }

    // Gmail SMTP settings or custom SMTP from env
    const transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || "smtp.gmail.com",
      port: parseInt(process.env.SMTP_PORT || "465", 10),
      secure: process.env.SMTP_PORT ? process.env.SMTP_PORT === "465" : true, // true for 465, false for other ports
      auth: {
        user: smtpUser,
        pass: smtpPass,
      },
      tls: {
        rejectUnauthorized: false
      }
    });

    const mailOptions = {
      from: `"GNXT Support Portal" <${smtpUser}>`,
      to: "support@madhuratechnologies.com",
      replyTo: contactEmail || smtpUser,
      subject: `[Support Ticket] Issue in ${module}`,
      html: `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 12px; background-color: #ffffff;">
          <h2 style="color: #1d4ed8; border-bottom: 2px solid #f3f4f6; padding-bottom: 10px; margin-top: 0;">Support from Madura Technologies</h2>
          <p style="font-size: 15px; color: #374151;">A new support request has been submitted from the application portal.</p>
          
          <table style="width: 100%; border-collapse: collapse; margin-top: 15px;">
            <tr style="background-color: #f9fafb;">
              <td style="padding: 10px; font-weight: bold; width: 150px; color: #4b5563; border: 1px solid #f3f4f6;">Affected Module:</td>
              <td style="padding: 10px; color: #111827; font-weight: 600; border: 1px solid #f3f4f6;">${module}</td>
            </tr>
            ${contactName ? `
            <tr>
              <td style="padding: 10px; font-weight: bold; color: #4b5563; border: 1px solid #f3f4f6;">Contact Name:</td>
              <td style="padding: 10px; color: #111827; border: 1px solid #f3f4f6;">${contactName}</td>
            </tr>
            ` : ""}
            ${contactEmail ? `
            <tr style="background-color: #f9fafb;">
              <td style="padding: 10px; font-weight: bold; color: #4b5563; border: 1px solid #f3f4f6;">Contact Email:</td>
              <td style="padding: 10px; color: #111827; border: 1px solid #f3f4f6;"><a href="mailto:${contactEmail}" style="color: #1d4ed8; text-decoration: none;">${contactEmail}</a></td>
            </tr>
            ` : ""}
            <tr>
              <td style="padding: 10px; font-weight: bold; color: #4b5563; border: 1px solid #f3f4f6; vertical-align: top;">Issue Details:</td>
              <td style="padding: 10px; color: #111827; border: 1px solid #f3f4f6; line-height: 1.5; white-space: pre-wrap;">${description}</td>
            </tr>
            <tr style="background-color: #f9fafb;">
              <td style="padding: 10px; font-weight: bold; color: #4b5563; border: 1px solid #f3f4f6;">Submitted At:</td>
              <td style="padding: 10px; color: #6b7280; border: 1px solid #f3f4f6;">${new Date().toLocaleString()}</td>
            </tr>
          </table>
          
          <div style="margin-top: 25px; padding-top: 15px; border-top: 1px solid #f3f4f6; text-align: center; font-size: 12px; color: #9ca3af;">
            This email was automatically generated by the GNXT Support System.
          </div>
        </div>
      `,
    };

    try {
      const info = await transporter.sendMail(mailOptions);
      console.log(`[Support Mail] Ticket sent successfully. Message ID: ${info.messageId}`);
      res.status(200).json({
        success: true,
        message: "Support ticket submitted successfully. Our team will get back to you shortly.",
        messageId: info.messageId
      });
    } catch (sendError) {
      console.error("Nodemailer failed to send email:", sendError);
      
      if (isDev) {
        console.warn("[DEVELOPMENT FALLBACK] SMTP transaction failed. Logging email details to console instead.");
        logMockEmail();
        return res.status(200).json({
          success: true,
          message: "Support ticket submitted successfully. (Dev Fallback: SMTP failed; email logged to backend console.)",
          isMock: true
        });
      }
      
      throw sendError;
    }
  } catch (err) {
    console.error("Error sending support ticket email:", err);
    res.status(500).json({
      success: false,
      message: "Failed to send support ticket.",
      error: err.message
    });
  }
};
