import React, { useState } from 'react';
import { Upload, Download, AlertCircle } from 'lucide-react';
import './App.css';

const M3ToSnowflakeConverter = () => {
  const [jsonInput, setJsonInput] = useState('');
  const [sqlOutput, setSqlOutput] = useState('');
  const [tableName, setTableName] = useState('');
  const [error, setError] = useState('');
  const [silverSql, setSilverSql] = useState('');

  // --- Type mapping ---
  const mapM3TypeToSnowflake = (property) => {
    const { type, format, maximum, multipleOf } = property;
    const dateTimeFormat = property['x-dateTimeFormat'];

    if (format === 'date-time') return 'DATETIME';
    if (dateTimeFormat === 'epoch-millis') return 'NUMBER';
    if (type === 'boolean') return 'BOOLEAN';
    if (type === 'integer') return 'INTEGER';
    if (type === 'number') {
      let hasDecimals = false;
      let scale = 0;

      if (multipleOf && multipleOf.toString().includes('.')) {
        hasDecimals = true;
        scale = multipleOf.toString().split('.')[1]?.length || 0;
      }

      if (!hasDecimals && maximum && maximum.toString().includes('.')) {
        hasDecimals = true;
        scale = maximum.toString().split('.')[1]?.length || 0;
      }

      if (hasDecimals) {
        let precision = 38;
        if (maximum) {
          const maxStr = maximum.toString().replace('E', 'e');
          if (maxStr.includes('e')) {
            const [mantissa, exponent] = maxStr.split('e');
            const exp = parseInt(exponent);
            precision = Math.abs(exp) + mantissa.replace('.', '').replace('-', '').length;
          } else {
            precision = maxStr.replace('.', '').replace('-', '').length;
          }
        }
        precision = Math.min(precision, 38);
        return `NUMBER(${precision}, ${scale})`;
      }

      return 'NUMBER';
    }

    if (type === 'string') return 'STRING';
    if (type === 'object') return 'STRING';
    return 'STRING';
  };

  // --- Convert M3 JSON to Snowflake DDL ---
  const convertToSnowflake = () => {
    try {
      setError('');
      const schema = JSON.parse(jsonInput);
      const table = tableName || schema.title?.toUpperCase().replace(/\s+/g, '_') || 'UNKNOWN_TABLE';
      const properties = schema.properties || {};
      const required = schema.required || [];

      let sql = `-- Table: ${table}\n`;
      sql += `-- Description: ${schema.description || 'No description'}\n`;
      sql += `CREATE OR ALTER TABLE ${table} (\n`;

      const columns = [];
      const sortedProps = Object.entries(properties).sort(
        (a, b) => (a[1]['x-position'] || 999) - (b[1]['x-position'] || 999)
      );

      for (const [propName, propDef] of sortedProps) {
        const snowflakeType = mapM3TypeToSnowflake(propDef);
        const isRequired = required.includes(propName);
        const notNull = isRequired ? ' NOT NULL' : '';
        const comment = propDef.description ? ` COMMENT '${propDef.description}'` : '';
        columns.push(`    ${propName} ${snowflakeType}${notNull}${comment}`);
      }

      sql += columns.join(',\n');
      sql += '\n)';

      if (schema.description) {
        sql += `\nCHANGE_TRACKING = TRUE`;
        sql += `\nCOMMENT = '${schema.description}'`;
      }

      const pkCandidates = required.filter(r =>
        ['CONO', 'SUNO', 'variationNumber', 'timestamp', 'deleted'].includes(r) || r.toLowerCase().includes('id')
      );

      if (pkCandidates.length > 0) {
        sql += `\n\n-- Primary key:\n`;
        sql += `-- ALTER TABLE ${table} ADD PRIMARY KEY (${pkCandidates.join(', ')});\n`;
      }

      setSqlOutput(sql);
    } catch (err) {
      setError(`Error parsing JSON: ${err.message}`);
      setSqlOutput('');
    }
  };

  // --- Generate Silver SQL from Bronze ---
  const generateSilverFromBronze = () => {
    if (!jsonInput) {
      setSilverSql('-- No JSON input available yet');
      return;
    }

    try {
      const schema = JSON.parse(jsonInput);
      const properties = schema.properties || {};
      const sortedProps = Object.entries(properties).sort(
        (a, b) => (a[1]['x-position'] || 999) - (b[1]['x-position'] || 999)
      );

      const table = tableName || schema.title?.toUpperCase().replace(/\s+/g, '_') || 'UNKNOWN_TABLE';
      const excludeCols = ['ACCOUNTINGENTITY', 'VARIATIONNUMBER', 'TIMESTAMP', 'DELETED', 'ARCHIVED', 'ROW_NUM'];

      // Build BRONZE select with TRIM for string columns
      const bronzeSelectLines = sortedProps.map(([name, def]) => {
        const type = mapM3TypeToSnowflake(def);
        if (type === 'STRING') return `TRIM(${name}) AS ${name}`;
        return name;
      });

      bronzeSelectLines.push(
        'ROW_NUMBER() OVER (PARTITION BY CONO, SUNO ORDER BY VARIATIONNUMBER DESC) AS ROW_NUM'
      );

      let silver = `CREATE OR REPLACE DYNAMIC TABLE ${table}\nTARGET_LAG= DOWNSTREAM\nWAREHOUSE={{env}}_ANALYTICS_WH\nREFRESH_MODE = INCREMENTAL\nINITIALIZE=ON_CREATE\nAS\nWITH BRONZE AS (\n    SELECT ${bronzeSelectLines.join(',\n           ')}\n    FROM {{env}}_BRONZE.${table} b\n)\n\n`;

      // Final Silver query with EXCLUDE
      silver += `SELECT *\n       EXCLUDE (${excludeCols.join(', ')})\nFROM BRONZE\nWHERE ROW_NUM = 1 AND DELETED = FALSE;\n`;

      setSilverSql(silver);
    } catch (err) {
      setSilverSql(`-- Error generating silver query: ${err.message}`);
    }
  };

  // --- File upload handler ---
  const handleFileUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (event) => setJsonInput(event.target.result);
      reader.readAsText(file);
    }
  };

  // --- Download Snowflake SQL ---
  const downloadSQL = () => {
    const blob = new Blob([sqlOutput], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${tableName || 'schema'}.sql`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // --- Load example JSON schema ---
  const loadExample = () => {
    const example = `{
  "$schema": "http://json-schema.org/draft-06/schema#",
  "title": "Supplier",
  "description": "Supplier master data",
  "type": "object",
  "properties": {
    "CONO": { "title": "company", "description": "company", "type": "integer", "maximum": 999, "x-position": 1 },
    "SUNO": { "title": "supplier", "description": "supplier", "type": "string", "maxLength": 10, "x-position": 2 },
    "SUNM": { "title": "supplier name", "description": "supplier name", "type": "string", "maxLength": 36, "x-position": 3 },
    "variationNumber": { "description": "record modification sequence", "type": "integer", "maximum": 9223372036854775807, "x-position": 4 },
    "timestamp": { "description": "record modification time", "type": "string", "format": "date-time", "x-position": 5 },
    "deleted": { "description": "is record deleted", "type": "boolean", "x-position": 6 }
  },
  "required": ["CONO", "SUNO", "variationNumber", "timestamp", "deleted"]
}`;
    setJsonInput(example);
    setTableName(''); // optional
  };

  return (
    <div className="w-full min-h-screen bg-gradient-to-br from-blue-50 to-indigo-100 p-6">
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
                <button onClick={loadExample} className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded transition-colors">Load Example</button>
                <label className="px-3 py-1 text-sm bg-indigo-100 hover:bg-indigo-200 rounded cursor-pointer transition-colors flex items-center gap-1">
                  <Upload size={14} /> Upload
                  <input type="file" accept=".json" onChange={handleFileUpload} className="hidden" />
                </label>
              </div>
            </div>
            <input
              type="text"
              placeholder="Full Table Name (optional, e.g., M3CE_DBO.CIDMAS)"
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
          <div className="bg-white rounded-lg shadow-lg p-6 flex flex-col gap-6">
            {/* Snowflake DDL */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <h2 className="text-xl font-semibold text-gray-800">Snowflake DDL</h2>
                <div className="flex gap-2">
                  {sqlOutput && (
                    <>
                      <button onClick={downloadSQL} className="px-3 py-1 text-sm bg-green-100 hover:bg-green-200 rounded flex items-center gap-1">
                        <Download size={14} /> Download
                      </button>
                      <button onClick={() => navigator.clipboard.writeText(sqlOutput)} className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded">Copy</button>
                    </>
                  )}
                </div>
              </div>
              <textarea
                value={sqlOutput}
                readOnly
                placeholder="Snowflake DDL will appear here..."
                className="w-full h-64 p-3 border border-gray-300 rounded font-mono text-sm resize-none bg-gray-50 focus:outline-none"
              />
            </div>

            {/* Silver SQL */}
            <div>
              {sqlOutput && (
                <button
                  onClick={generateSilverFromBronze}
                  className="w-full mb-2 bg-purple-600 hover:bg-purple-700 text-white font-semibold py-2 rounded transition-colors"
                >
                  Generate Silver Table SQL
                </button>
              )}
              {silverSql && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-lg font-semibold text-gray-700">Silver Layer SQL</h3>
                  <textarea
                    value={silverSql}
                    readOnly
                    className="w-full h-64 p-3 border border-gray-300 rounded font-mono text-sm resize-none bg-gray-50 focus:outline-none"
                  />
                  <button
                    onClick={() => navigator.clipboard.writeText(silverSql)}
                    className="w-full bg-gray-700 hover:bg-gray-800 text-white py-2 rounded transition-colors"
                  >
                    Copy Silver SQL
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default M3ToSnowflakeConverter;
