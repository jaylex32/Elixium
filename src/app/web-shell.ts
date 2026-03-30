export const getDefaultWebShell = (appBrand: string): string => `<!DOCTYPE html>
<html>
<head>
    <title>${appBrand}</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            text-align: center;
            padding: 50px;
            background: #1a1a1a;
            color: white;
        }
        .container {
            max-width: 600px;
            margin: 0 auto;
            background: #2a2a2a;
            padding: 40px;
            border-radius: 12px;
        }
        h1 { color: #667EEA; }
        .note { margin: 20px 0; padding: 15px; background: #333; border-radius: 8px; }
    </style>
</head>
<body>
    <div class="container">
        <h1>${appBrand}</h1>
        <div class="note">
            <p>Web interface is starting up...</p>
            <p>Please create a proper HTML file in public/index.html for the full interface.</p>
        </div>
    </div>
</body>
</html>`;
