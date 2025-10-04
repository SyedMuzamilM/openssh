export interface ParsedCommand {
  command: string;
  args: string[];
  options: Record<string, string | boolean>;
}

export function parseCommandLine(input: string): ParsedCommand | undefined {
  const tokens = tokenize(input.trim());
  if (tokens.length === 0) {
    return undefined;
  }
  const command = tokens[0]!;
  const rest = tokens.slice(1);
  const args: string[] = [];
  const options: Record<string, string | boolean> = {};

  for (let index = 0; index < rest.length; index += 1) {
    const token = rest[index];
    if (!token) {
      continue;
    }
    if (token.startsWith('--')) {
      const keyValue = token.slice(2);
      if (keyValue.includes('=')) {
        const [key, value = ''] = keyValue.split(/=(.+)/);
        if (key) {
          options[key] = value;
        }
      } else {
        const nextToken = rest[index + 1];
        if (nextToken && !nextToken.startsWith('--')) {
          options[keyValue] = nextToken;
          index += 1;
        } else {
          options[keyValue] = true;
        }
      }
    } else {
      args.push(token);
    }
  }

  return { command, args, options };
}

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar: string | undefined;

  for (let i = 0; i < input.length; i += 1) {
    const char = input[i]!;

    if ((char === '"' || char === "'") && !inQuotes) {
      inQuotes = true;
      quoteChar = char;
      continue;
    }

    if (inQuotes && char === quoteChar) {
      inQuotes = false;
      quoteChar = undefined;
      continue;
    }

    if (!inQuotes && /\s/.test(char)) {
      if (current.length > 0) {
        tokens.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}
