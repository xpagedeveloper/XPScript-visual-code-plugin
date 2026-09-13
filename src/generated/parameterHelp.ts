export interface ApiParameterHelp {
  name: string;
  type?: string;
  required: boolean;
  default?: string | number | boolean | null;
  description: string;
}

export const parameterHelp: Record<string, ApiParameterHelp[]> = {
  "asc": [
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    }
  ],
  "chr": [
    {
      "name": "code",
      "required": true,
      "description": "Character code."
    }
  ],
  "instr": [
    {
      "name": "start",
      "required": false,
      "description": "Optional one-based position to begin searching."
    },
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    },
    {
      "name": "search",
      "required": true,
      "description": "Text to find."
    },
    {
      "name": "compare",
      "required": false,
      "description": "Optional comparison mode."
    }
  ],
  "instrb": [
    {
      "name": "start",
      "required": false,
      "description": "Optional one-based byte position to begin searching."
    },
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    },
    {
      "name": "search",
      "required": true,
      "description": "Text to find."
    }
  ],
  "lcase": [
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    }
  ],
  "left": [
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    },
    {
      "name": "count",
      "required": true,
      "description": "Number of characters to return."
    }
  ],
  "leftb": [
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    },
    {
      "name": "count",
      "required": true,
      "description": "Number of bytes to return."
    }
  ],
  "len": [
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    }
  ],
  "lenb": [
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    }
  ],
  "lset": [
    {
      "name": "value",
      "required": true,
      "description": "Value to format."
    },
    {
      "name": "width",
      "required": true,
      "description": "Field width."
    }
  ],
  "ltrim": [
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    }
  ],
  "mid": [
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    },
    {
      "name": "start",
      "required": true,
      "description": "One-based start position."
    },
    {
      "name": "count",
      "required": false,
      "description": "Optional number of characters to return."
    }
  ],
  "midb": [
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    },
    {
      "name": "start",
      "required": true,
      "description": "One-based byte start position."
    },
    {
      "name": "count",
      "required": false,
      "description": "Optional number of bytes to return."
    }
  ],
  "replace": [
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    },
    {
      "name": "find",
      "required": true,
      "description": "Text to find."
    },
    {
      "name": "replacement",
      "required": true,
      "description": "Replacement text."
    }
  ],
  "right": [
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    },
    {
      "name": "count",
      "required": true,
      "description": "Number of characters to return."
    }
  ],
  "rightb": [
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    },
    {
      "name": "count",
      "required": true,
      "description": "Number of bytes to return."
    }
  ],
  "rset": [
    {
      "name": "value",
      "required": true,
      "description": "Value to format."
    },
    {
      "name": "width",
      "required": true,
      "description": "Field width."
    }
  ],
  "rtrim": [
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    }
  ],
  "space": [
    {
      "name": "count",
      "required": true,
      "description": "Number of spaces."
    }
  ],
  "str": [
    {
      "name": "number",
      "required": true,
      "description": "Number to format."
    }
  ],
  "strcompare": [
    {
      "name": "left",
      "required": true,
      "description": "Left string."
    },
    {
      "name": "right",
      "required": true,
      "description": "Right string."
    },
    {
      "name": "compare",
      "required": false,
      "description": "Optional comparison mode."
    }
  ],
  "strconv": [
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    },
    {
      "name": "conversion",
      "required": true,
      "description": "Conversion mode: upper, lower, proper, or numeric 1, 2, or 3."
    }
  ],
  "string": [
    {
      "name": "count",
      "required": true,
      "description": "Repeat count."
    },
    {
      "name": "character",
      "required": true,
      "description": "Character or value to repeat."
    }
  ],
  "strleft": [
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    },
    {
      "name": "delimiter",
      "required": true,
      "description": "Delimiter text."
    }
  ],
  "strleftback": [
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    },
    {
      "name": "delimiter",
      "required": true,
      "description": "Delimiter text."
    }
  ],
  "strreverse": [
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    }
  ],
  "strright": [
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    },
    {
      "name": "delimiter",
      "required": true,
      "description": "Delimiter text."
    }
  ],
  "strrightback": [
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    },
    {
      "name": "delimiter",
      "required": true,
      "description": "Delimiter text."
    }
  ],
  "strtoken": [
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    },
    {
      "name": "delimiter",
      "required": true,
      "description": "Delimiter text."
    },
    {
      "name": "index",
      "required": true,
      "description": "One-based token index."
    }
  ],
  "trim": [
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    }
  ],
  "ucase": [
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    }
  ],
  "uchr": [
    {
      "name": "codePoint",
      "required": true,
      "description": "Unicode code point."
    }
  ],
  "uni": [
    {
      "name": "text",
      "required": true,
      "description": "Source text."
    }
  ],
  "val": [
    {
      "name": "text",
      "required": true,
      "description": "Numeric text."
    }
  ],
  "notessession": [
    {
      "name": "runtimeDirectory",
      "type": "String",
      "required": true,
      "description": "Directory containing the Notes/Domino native runtime."
    },
    {
      "name": "notesIni",
      "type": "String",
      "required": false,
      "description": "Optional explicit path to notes.ini."
    },
    {
      "name": "idPassword",
      "type": "String",
      "required": false,
      "description": "Optional ID password used during Notes initialization."
    }
  ]
};
