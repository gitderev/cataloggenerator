import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface FileResult {
  filename: string;
  path: string;
  url: string;
  size: number;
}

interface SuccessResponse {
  status: "ok";
  files: {
    stockFile: FileResult;
    priceFile: FileResult;
  };
}

interface ErrorResponse {
  status: "error";
  code: string;
  message: string;
}

// TEST: Stock + Price files
const STOCK_FILE = { ftpName: "StockFileData_790813.txt", folder: "stock", prefix: "StockFileData" };
const PRICE_FILE = { ftpName: "pricefileData_790813.txt", folder: "price", prefix: "pricefileData" };

const TIMEOUT_MS = 300000; // 5 minutes
const BUCKET_NAME = "ftp-import";

class FTPClient {
  private conn: Deno.Conn | null = null;
  private reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  private buffer = "";
  private useTLS: boolean;

  constructor(useTLS: boolean = false) {
    this.useTLS = useTLS;
  }

  private async readResponse(): Promise<string> {
    if (!this.reader) throw new Error("Not connected");
    
    while (true) {
      const lines = this.buffer.split("\r\n");
      for (let i = 0; i < lines.length - 1; i++) {
        const line = lines[i];
        if (line.match(/^\d{3} /)) {
          const response = lines.slice(0, i + 1).join("\r\n");
          this.buffer = lines.slice(i + 1).join("\r\n");
          return response;
        }
      }
      
      const { value, done } = await this.reader.read();
      if (done) throw new Error("Connection closed unexpectedly");
      this.buffer += new TextDecoder().decode(value);
    }
  }

  private async sendCommand(cmd: string): Promise<string> {
    if (!this.conn) throw new Error("Not connected");
    const encoder = new TextEncoder();
    await this.conn.write(encoder.encode(cmd + "\r\n"));
    return await this.readResponse();
  }

  private parseResponse(response: string): { code: number; message: string } {
    const match = response.match(/^(\d{3})/);
    if (!match) throw new Error("Invalid FTP response");
    return { code: parseInt(match[1]), message: response };
  }

  async connect(host: string, port: number): Promise<void> {
    console.log(`Connecting to ${host}:${port}...`);
    
    if (this.useTLS) {
      this.conn = await Deno.connectTls({ hostname: host, port });
    } else {
      this.conn = await Deno.connect({ hostname: host, port });
    }
    
    this.reader = this.conn.readable.getReader();
    const welcome = await this.readResponse();
    console.log("Welcome:", welcome);
    
    const { code } = this.parseResponse(welcome);
    if (code !== 220) {
      throw new Error(`Unexpected welcome code: ${code}`);
    }
  }

  async login(user: string, pass: string): Promise<void> {
    console.log("Logging in...");
    
    const userResp = await this.sendCommand(`USER ${user}`);
    const { code: userCode } = this.parseResponse(userResp);
    
    if (userCode === 331) {
      const passResp = await this.sendCommand(`PASS ${pass}`);
      const { code: passCode } = this.parseResponse(passResp);
      if (passCode !== 230) {
        throw new Error(`Login failed: ${passResp}`);
      }
    } else if (userCode !== 230) {
      throw new Error(`Login failed: ${userResp}`);
    }
    
    console.log("Logged in successfully");
  }

  async cwd(dir: string): Promise<void> {
    console.log(`Changing directory to: ${dir}`);
    const resp = await this.sendCommand(`CWD ${dir}`);
    const { code } = this.parseResponse(resp);
    if (code !== 250) {
      throw new Error(`CWD_FAILED:${resp}`);
    }
  }

  async setPassiveMode(): Promise<{ host: string; port: number }> {
    const resp = await this.sendCommand("PASV");
    const { code } = this.parseResponse(resp);
    if (code !== 227) {
      throw new Error(`PASV failed: ${resp}`);
    }
    
    const match = resp.match(/\((\d+),(\d+),(\d+),(\d+),(\d+),(\d+)\)/);
    if (!match) {
      throw new Error("Could not parse PASV response");
    }
    
    const host = `${match[1]}.${match[2]}.${match[3]}.${match[4]}`;
    const port = parseInt(match[5]) * 256 + parseInt(match[6]);
    
    return { host, port };
  }

  async setBinaryMode(): Promise<void> {
    const resp = await this.sendCommand("TYPE I");
    const { code } = this.parseResponse(resp);
    if (code !== 200) {
      console.warn("Could not set binary mode:", resp);
    }
  }

  async downloadFile(filename: string): Promise<Uint8Array> {
    console.log(`Downloading file: ${filename}`);
    
    await this.setBinaryMode();
    
    const { host, port } = await this.setPassiveMode();
    console.log(`Passive mode: ${host}:${port}`);
    
    const dataConn = await Deno.connect({ hostname: host, port });
    
    const retrResp = await this.sendCommand(`RETR ${filename}`);
    const { code: retrCode } = this.parseResponse(retrResp);
    
    if (retrCode === 550) {
      try { dataConn.close(); } catch (_) { /* ignore */ }
      throw new Error(`FILE_NOT_FOUND:${filename}`);
    }
    
    if (retrCode !== 125 && retrCode !== 150) {
      try { dataConn.close(); } catch (_) { /* ignore */ }
      throw new Error(`FTP_DOWNLOAD_FAILED:${retrResp}`);
    }
    
    // Read all data
    const chunks: Uint8Array[] = [];
    let totalSize = 0;
    
    try {
      const buf = new Uint8Array(65536); // 64KB buffer
      while (true) {
        const n = await dataConn.read(buf);
        if (n === null) break;
        chunks.push(buf.slice(0, n));
        totalSize += n;
      }
    } catch (e) {
      console.log(`Read completed or error: ${e}`);
    }
    
    try { dataConn.close(); } catch (_) { /* ignore */ }
    
    // Wait for transfer complete
    const completeResp = await this.readResponse();
    const { code: completeCode } = this.parseResponse(completeResp);
    if (completeCode !== 226 && completeCode !== 250) {
      console.warn("Unexpected transfer complete response:", completeResp);
    }
    
    // Combine chunks
    const result = new Uint8Array(totalSize);
    let offset = 0;
    for (const chunk of chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    chunks.length = 0;
    
    console.log(`Downloaded ${filename}: ${totalSize} bytes`);
    return result;
  }

  async close(): Promise<void> {
    if (this.conn) {
      try { await this.sendCommand("QUIT"); } catch (_e) { /* ignore */ }
      if (this.reader) {
        try { this.reader.releaseLock(); } catch (_e) { /* ignore */ }
      }
      try { this.conn.close(); } catch (_e) { /* ignore */ }
      this.conn = null;
      this.reader = null;
    }
  }
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorCode: string): Promise<T> {
  let timeoutId: number;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => reject(new Error(`${errorCode}:Timeout`)), timeoutMs);
  });
  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (e) {
    clearTimeout(timeoutId!);
    throw e;
  }
}

// Helper to download and upload a single file
async function processFile(
  client: FTPClient,
  supabase: ReturnType<typeof createClient>,
  fileConfig: { ftpName: string; folder: string; prefix: string },
  timestamp: number
): Promise<FileResult> {
  console.log(`Processing: ${fileConfig.ftpName}`);
  
  // Download from FTP
  const fileBuffer = await withTimeout(client.downloadFile(fileConfig.ftpName), TIMEOUT_MS, "FTP_TIMEOUT");
  const fileSize = fileBuffer.length;
  console.log(`Downloaded: ${fileSize} bytes`);
  
  // Upload to Storage
  const newFilename = `${fileConfig.prefix}_${timestamp}.txt`;
  const storagePath = `${fileConfig.folder}/${newFilename}`;
  
  console.log(`Uploading to: ${storagePath}`);
  
  const { error: uploadError } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(storagePath, fileBuffer, { contentType: "text/plain", upsert: true });
  
  if (uploadError) {
    throw new Error(`STORAGE_ERROR:${uploadError.message}`);
  }
  
  console.log(`Uploaded successfully`);
  
  // Get public URL
  const { data: urlData } = supabase.storage.from(BUCKET_NAME).getPublicUrl(storagePath);
  
  return {
    filename: newFilename,
    path: storagePath,
    url: urlData.publicUrl,
    size: fileSize,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return new Response(
      JSON.stringify({ status: "error", code: "METHOD_NOT_ALLOWED", message: "Only POST" } as ErrorResponse),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }

  let client: FTPClient | null = null;

  try {
    const ftpHost = Deno.env.get('FTP_HOST');
    const ftpUser = Deno.env.get('FTP_USER');
    const ftpPass = Deno.env.get('FTP_PASSWORD');
    const ftpPort = parseInt(Deno.env.get('FTP_PORT') || '21');
    const ftpInputDir = Deno.env.get('FTP_INPUT_DIR') || '/';
    const ftpUseTLS = Deno.env.get('FTP_USE_TLS') === 'true';
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    console.log(`FTP Config: host=${ftpHost ? 'SET' : 'UNSET'}, port=${ftpPort}, dir=${ftpInputDir}`);

    if (!ftpHost || !ftpUser || !ftpPass) {
      return new Response(
        JSON.stringify({ status: "error", code: "CONFIG_MISSING", message: "FTP config missing" } as ErrorResponse),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!supabaseUrl || !supabaseServiceKey) {
      return new Response(
        JSON.stringify({ status: "error", code: "CONFIG_MISSING", message: "Supabase config missing" } as ErrorResponse),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    client = new FTPClient(ftpUseTLS);

    await withTimeout(client.connect(ftpHost, ftpPort), TIMEOUT_MS, "FTP_TIMEOUT");
    await withTimeout(client.login(ftpUser, ftpPass), TIMEOUT_MS, "FTP_TIMEOUT");

    try {
      await withTimeout(client.cwd(ftpInputDir), TIMEOUT_MS, "FTP_TIMEOUT");
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (errMsg.includes("CWD_FAILED") || errMsg.includes("550")) {
        return new Response(
          JSON.stringify({ status: "error", code: "FTP_DIR_NOT_FOUND", message: `Directory ${ftpInputDir} not found` } as ErrorResponse),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw e;
    }

    const timestamp = Date.now();

    // Process Stock file first (smaller ~6MB)
    let stockResult: FileResult;
    try {
      stockResult = await processFile(client, supabase, STOCK_FILE, timestamp);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (errMsg.includes("FILE_NOT_FOUND")) {
        return new Response(
          JSON.stringify({ status: "error", code: "FILE_NOT_FOUND", message: `Stock file not found` } as ErrorResponse),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw e;
    }

    // Process Price file (~50MB)
    let priceResult: FileResult;
    try {
      priceResult = await processFile(client, supabase, PRICE_FILE, timestamp);
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      if (errMsg.includes("FILE_NOT_FOUND")) {
        return new Response(
          JSON.stringify({ status: "error", code: "FILE_NOT_FOUND", message: `Price file not found` } as ErrorResponse),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
      throw e;
    }

    // Close FTP connection
    await client.close();
    client = null;

    const response: SuccessResponse = {
      status: "ok",
      files: {
        stockFile: stockResult,
        priceFile: priceResult,
      },
    };

    console.log("All files processed successfully");
    
    return new Response(
      JSON.stringify(response),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (e) {
    console.error("Error:", e);
    const errMsg = e instanceof Error ? e.message : String(e);
    
    return new Response(
      JSON.stringify({ status: "error", code: "FTP_RUNTIME_ERROR", message: errMsg.substring(0, 200) } as ErrorResponse),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
    
  } finally {
    if (client) {
      try { await client.close(); } catch (_e) { /* ignore */ }
    }
  }
});
