// Define required column groups for validation
export const REQUIRED_COLUMN_GROUPS = {
  plantReference: {
    name: "Plant Reference",
    keywords: ["Plant Reference Number", "Plant No", "Plant"],
    fuzzyPatterns: [/plant/i],
  },
  customerName: {
    name: "Customer Name",
    keywords: ["Customer Name", "Customer"],
    fuzzyPatterns: [/customer\s*name/i, /^customer$/i, /client/i, /dealer/i],
  },
  invoiceNumber: {
    name: "Invoice Number",
    keywords: ["Invoice", "Invoice Number", "Invoice #", "Invoice No"],
    fuzzyPatterns: [/invoice\s*no/i, /invoice\s*num/i, /invoice\s*#/i, /^invoice$/i],
  },
  invoiceDate: {
    name: "Invoice Date",
    keywords: ["Invoice Date", "Date", "Invoice Dt"],
    fuzzyPatterns: [/invoice\s*date/i, /invoice\s*dt/i, /^date$/i, /dt$/i],
  },
  location: {
    name: "Location",
    keywords: ["District", "Location", "City", "Dealer Location", "Delivery Location", "Address", "Customer Location"],
    fuzzyPatterns: [/location/i, /district/i, /city/i, /address/i, /delivery/i],
  },
};

// Define optional column groups for quantity and weight
export const OPTIONAL_COLUMN_GROUPS = {
  quantity: {
    name: "Quantity",
    keywords: ["Qty", "Quantity", "Invoice Qty", "Billing Qty"],
    fuzzyPatterns: [/qty/i, /quantity/i],
  },
  weight: {
    name: "Weight",
    keywords: ["Weight", "Total Weight", "Weight (Kg)", "Weight(Kg)"],
    fuzzyPatterns: [/weight/i, /kg/i],
  },
  tyre: {
    name: "Tyre",
    keywords: ["Tyres", "Tyre", "Tyre Qty", "Tyres Qty"],
    fuzzyPatterns: [/tyre/i],
  },
  tube: {
    name: "Tube",
    keywords: ["Tubes", "Tube", "Tube Qty", "Tubes Qty"],
    fuzzyPatterns: [/tube/i],
  },
  flap: {
    name: "Flap",
    keywords: ["Flaps", "Flap", "Flap Qty", "Flaps Qty", "Glaps", "Glap", "Glap Qty", "Glaps Qty"],
    fuzzyPatterns: [/flap/i, /glap/i],
  },
};

// Dynamically resolve actual sheet header keys using exact keywords or fuzzy regexes
export const resolveHeaderKeys = (sheetHeaders) => {
  const resolved = {
    plantReferenceNumber: null,
    customerName: null,
    invoiceNumber: null,
    invoiceDate: null,
    location: null,
    quantity: null,
    weight: null,
    tyre: null,
    tube: null,
    flap: null,
  };

  const headers = sheetHeaders.map(h => h.trim());

  const findMatch = (group) => {
    // 1. Try exact keyword match (case-insensitive)
    for (const kw of group.keywords) {
      const match = headers.find(h => h.toLowerCase() === kw.toLowerCase());
      if (match) return match;
    }
    // 2. Try fuzzy pattern match
    for (const pattern of group.fuzzyPatterns) {
      const match = headers.find(h => pattern.test(h));
      if (match) return match;
    }
    return null;
  };

  resolved.plantReferenceNumber = findMatch(REQUIRED_COLUMN_GROUPS.plantReference);
  resolved.customerName = findMatch(REQUIRED_COLUMN_GROUPS.customerName);
  resolved.invoiceNumber = findMatch(REQUIRED_COLUMN_GROUPS.invoiceNumber);
  resolved.invoiceDate = findMatch(REQUIRED_COLUMN_GROUPS.invoiceDate);
  resolved.location = findMatch(REQUIRED_COLUMN_GROUPS.location);
  resolved.quantity = findMatch(OPTIONAL_COLUMN_GROUPS.quantity);
  resolved.weight = findMatch(OPTIONAL_COLUMN_GROUPS.weight);
  resolved.tyre = findMatch(OPTIONAL_COLUMN_GROUPS.tyre);
  resolved.tube = findMatch(OPTIONAL_COLUMN_GROUPS.tube);
  resolved.flap = findMatch(OPTIONAL_COLUMN_GROUPS.flap);

  return resolved;
};

// Validate that sheet has at least one column from each required group
export const validateSheetColumns = (sheetHeaders) => {
  const resolved = resolveHeaderKeys(sheetHeaders);
  const missingGroups = [];

  if (!resolved.plantReferenceNumber) missingGroups.push(REQUIRED_COLUMN_GROUPS.plantReference.name);
  if (!resolved.customerName) missingGroups.push(REQUIRED_COLUMN_GROUPS.customerName.name);
  if (!resolved.invoiceNumber) missingGroups.push(REQUIRED_COLUMN_GROUPS.invoiceNumber.name);
  if (!resolved.invoiceDate) missingGroups.push(REQUIRED_COLUMN_GROUPS.invoiceDate.name);
  if (!resolved.location) missingGroups.push(REQUIRED_COLUMN_GROUPS.location.name);

  return missingGroups;
};

export const mapExcelRowToInvoice = (row, resolvedKeys) => {
  // normalize keys (remove extra spaces)
  const cleanRow = {};
  for (let key in row) {
    cleanRow[key.trim()] = row[key];
  }

  const getValue = (resolvedKey) => {
    if (resolvedKey && cleanRow[resolvedKey] !== undefined && cleanRow[resolvedKey] !== null) {
      return cleanRow[resolvedKey];
    }
    return "";
  };

  const parseDDMMYYYY = (str) => {
    const parts = str.match(/^(\d{1,2})[./](\d{1,2})[./](\d{4})$/);
    if (parts) {
      const [_, day, month, year] = parts;
      return new Date(+year, +month - 1, +day);
    }
    return null;
  };

  const normalizeDate = (excelDate) => {
    // Excel serial number support
    if (typeof excelDate === "number") {
      const jsDate = new Date((excelDate - 25569) * 86400 * 1000);
      jsDate.setHours(0, 0, 0, 0);
      return jsDate;
    }

    // Handle dd.mm.yyyy / dd/mm/yyyy (client format)
    if (typeof excelDate === "string") {
      const parsed = parseDDMMYYYY(excelDate);
      if (parsed) return parsed;
    }

    const d = new Date(excelDate);

    if (isNaN(d.getTime())) return null;

    d.setHours(0, 0, 0, 0);

    return d;
  };

  const parseNumber = (val) => {
    if (val === undefined || val === null || val === "") return 0;
    const cleanVal = String(val).replace(/,/g, "").trim();
    const num = Number(cleanVal);
    return isNaN(num) ? 0 : num;
  };

  return {
    plantReferenceNumber: String(getValue(resolvedKeys.plantReferenceNumber)).trim(),
    customerName: String(getValue(resolvedKeys.customerName)).trim(),
    invoiceNumber: String(getValue(resolvedKeys.invoiceNumber)).trim(),
    invoiceDate: normalizeDate(getValue(resolvedKeys.invoiceDate)),
    location: String(getValue(resolvedKeys.location)).trim(),
    quantity: parseNumber(getValue(resolvedKeys.quantity)),
    weight: parseNumber(getValue(resolvedKeys.weight)),
    tyre: parseNumber(getValue(resolvedKeys.tyre)),
    tube: parseNumber(getValue(resolvedKeys.tube)),
    flap: parseNumber(getValue(resolvedKeys.flap)),
  };
};