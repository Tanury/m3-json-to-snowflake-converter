import React, { useState } from 'react';
import { Upload, Download, AlertCircle } from 'lucide-react';
import './App.css';

const M3ToSnowflakeConverter = () => {
  const [jsonInput, setJsonInput] = useState('');
  const [sqlOutput, setSqlOutput] = useState('');
  const [tableName, setTableName] = useState('');
  const [error, setError] = useState('');

  const mapM3TypeToSnowflake = (property, propName) => {
    const { type, format, maximum, minimum, maxLength, title } = property;
    const description = property.description?.toLowerCase() || '';
    const titleLower = title?.toLowerCase() || '';
    
    // Handle date-time formats - Standard/American/Three-character month
    if (format === 'date-time' || titleLower.includes('datetime') || description.includes('datetime')) {
      return 'DATETIME';
    }
    
    // Handle dates - Standard/American/Basic format
    if (titleLower.includes('date') || description.includes('date')) {
      // Check if it's stored as integer (YYYYMMDD format common in M3)
      if (type === 'integer' && maximum && maximum <= 99999999) {
        return 'DATE';
      }
      return 'DATE';
    }
    
    // Handle time - Standard format (stored as integer HHMMSS)
    if (titleLower.includes('time') || description.includes('time')) {
      // Epoch millis should be NUMBER
      if (property['x-dateTimeFormat'] === 'epoch-millis') {
        return 'NUMBER';
      }
      // Other time formats stored as integers
      if (type === 'integer') {
        return 'TIME';
      }
      return 'STRING';
    }
    
    // Handle epoch datetime (stored as NUMBER not TIMESTAMP)
    if (property['x-dateTimeFormat'] === 'epoch-millis') {
      return 'NUMBER';
    }
    
    // Handle boolean
    if (type === 'boolean') {
      return 'BOOLEAN';
    }
    
    // Handle integer - ALL integers map to NUMBER in Snowflake
    if (type === 'integer') {
      return 'NUMBER';
    }
    
    // Handle number (decimal)
    if (type === 'number') {
      return 'NUMBER';
    }
    
    // Handle string
    if (type === 'string') {
      return 'STRING';
    }
    
    // Handle object type
    if (type === 'object') {
      return 'STRING';
    }
    
    return 'STRING'; // Default fallback
  };

  const convertToSnowflake = () => {
    try {
      setError('');
      const schema = JSON.parse(jsonInput);
      
      // Extract table name from title or id
      const table = tableName || schema.title?.toUpperCase().replace(/\s+/g, '_') || 'UNKNOWN_TABLE';
      
      const properties = schema.properties || {};
      const required = schema.required || [];
      
      let sql = `-- Table: ${table}\n`;
      sql += `-- Description: ${schema.description || 'No description'}\n`;
      sql += `CREATE OR REPLACE TABLE ${table} (\n`;
      
      const columns = [];
      
      // Sort by x-position if available
      const sortedProps = Object.entries(properties).sort((a, b) => {
        const posA = a[1]['x-position'] || 999;
        const posB = b[1]['x-position'] || 999;
        return posA - posB;
      });
      
      for (const [propName, propDef] of sortedProps) {
        const snowflakeType = mapM3TypeToSnowflake(propDef, propName);
        const isRequired = required.includes(propName);
        const notNull = isRequired ? ' NOT NULL' : '';
        const comment = propDef.description ? ` COMMENT '${propDef.description}'` : '';
        
        columns.push(`    ${propName} ${snowflakeType}${notNull}${comment}`);
      }
      
      sql += columns.join(',\n');
      sql += '\n)';
      
      // Add table comment
      if (schema.description) {
        sql += `\nCOMMENT = '${schema.description}'`;
      }
      
      sql += ';\n';
      
      // Add primary key if we can identify it
      const pkCandidates = required.filter(r => 
        r.includes('CONO') || r.includes('SUNO') || r.toLowerCase().includes('id')
      );
      
      if (pkCandidates.length > 0) {
        sql += `\n-- Suggested primary key (review and adjust as needed):\n`;
        sql += `-- ALTER TABLE ${table} ADD PRIMARY KEY (${pkCandidates.join(', ')});\n`;
      }
      
      setSqlOutput(sql);
    } catch (err) {
      setError(`Error parsing JSON: ${err.message}`);
      setSqlOutput('');
    }
  };

  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => {
        setJsonInput(event.target.result);
      };
      reader.readAsText(file);
    }
  };

  const downloadSQL = () => {
    const blob = new Blob([sqlOutput], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tableName || 'schema'}.sql`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const loadExample = () => {
    const example = `{
  "$schema": "http://json-schema.org/draft-06/schema#",
  "title": "Supplier",
  "description": "Supplier master data",
  "type": "object",
  "properties": {
    "CONO": {
      "title": "company",
      "description": "company",
      "type": "integer",
      "maximum": 999,
      "x-position": 1
    },
    "SUNO": {
      "title": "supplier",
      "description": "supplier",
      "type": "string",
      "maxLength": 10,
      "x-position": 2
    },
    "SUNM": {
      "title": "supplier name",
      "description": "supplier name",
      "type": "string",
      "maxLength": 36,
      "x-position": 4
    }
  },
  "required": ["CONO", "SUNO"]
}`;
    setJsonInput(example);
    setTableName('CIDMAS_SUPPLIER');
  };

  return (
    <div className="w-full h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6 overflow-auto">
      <div className="max-w-7xl mx-auto">
        <div className="bg-white rounded-lg shadow-xl p-6 mb-6">
          <h1 className="text-3xl font-bold text-indigo-900 mb-2">M3 JSON to Snowflake Converter</h1>
          <p className="text-gray-600">Convert Infor M3 JSON schemas to Snowflake DDL statements</p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Input Section */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-800">Input: M3 JSON Schema</h2>
              <div className="flex gap-2">
                <button
                  onClick={loadExample}
                  className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded transition-colors"
                >
                  Load Example
                </button>
                <label className="px-3 py-1 text-sm bg-indigo-100 hover:bg-indigo-200 rounded cursor-pointer transition-colors flex items-center gap-1">
                  <Upload size={14} />
                  Upload
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>
            </div>

            <input
              type="text"
              placeholder="Table Name (optional)"
              value={tableName}
              onChange={(e) => setTableName(e.target.value.toUpperCase())}
              className="w-full p-2 border border-gray-300 rounded mb-3 font-mono text-sm"
            />

            <textarea
              value={jsonInput}
              onChange={(e) => setJsonInput(e.target.value)}
              placeholder="Paste your M3 JSON schema here..."
              className="w-full h-96 p-3 border border-gray-300 rounded font-mono text-sm resize-none focus:outline-none focus:ring-2 focus:ring-indigo-500"
            />

            <button
              onClick={convertToSnowflake}
              className="w-full mt-4 bg-indigo-600 hover:bg-indigo-700 text-white font-semibold py-3 rounded-lg transition-colors shadow-md"
            >
              Convert to Snowflake DDL
            </button>

            {error && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 rounded flex items-start gap-2">
                <AlertCircle className="text-red-500 flex-shrink-0 mt-0.5" size={18} />
                <p className="text-red-700 text-sm">{error}</p>
              </div>
            )}
          </div>

          {/* Output Section */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-semibold text-gray-800">Output: Snowflake DDL</h2>
              {sqlOutput && (
                <button
                  onClick={downloadSQL}
                  className="px-3 py-1 text-sm bg-green-100 hover:bg-green-200 rounded transition-colors flex items-center gap-1"
                >
                  <Download size={14} />
                  Download
                </button>
              )}
            </div>

            <textarea
              value={sqlOutput}
              readOnly
              placeholder="Snowflake DDL will appear here..."
              className="w-full h-96 p-3 border border-gray-300 rounded font-mono text-sm resize-none bg-gray-50 focus:outline-none"
            />

            {sqlOutput && (
              <button
                onClick={() => navigator.clipboard.writeText(sqlOutput)}
                className="w-full mt-4 bg-gray-600 hover:bg-gray-700 text-white font-semibold py-2 rounded transition-colors"
              >
                Copy to Clipboard
              </button>
            )}
          </div>
        </div>

        {/* Mapping Reference */}
        <div className="bg-white rounded-lg shadow-lg p-6 mt-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-3">Type Mapping Reference (M3 Data Catalog → Snowflake)</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
            <div><span className="font-semibold">Datetime (Standard/American/3-char):</span> DATETIME</div>
            <div><span className="font-semibold">Datetime (Other):</span> STRING</div>
            <div><span className="font-semibold">Date (Standard/American/Basic):</span> DATE</div>
            <div><span className="font-semibold">Time (Other):</span> STRING</div>
            <div><span className="font-semibold">Time (Standard):</span> TIME</div>
            <div><span className="font-semibold">Datetime (Epoch):</span> NUMBER</div>
            <div><span className="font-semibold">Integer (all ranges):</span> NUMBER</div>
            <div><span className="font-semibold">Number:</span> NUMBER</div>
            <div><span className="font-semibold">Boolean:</span> BOOLEAN</div>
            <div><span className="font-semibold">String:</span> STRING</div>
            <div><span className="font-semibold">Object:</span> STRING</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default M3ToSnowflakeConverter;