import re

# Read file
with open('infrastructure/lib/gateway-target-stack.ts', 'r') as f:
    content = f.read()

# Pattern to find inputSchema blocks and extract property names with required: true
# Then add required array after type: 'object'

# Replace individual required: true with nothing and collect field names
lines = content.split('\n')
new_lines = []
i = 0

while i < len(lines):
    line = lines[i]
    
    # Check if this is an inputSchema line
    if 'inputSchema: {' in line:
        # Collect this block
        indent = len(line) - len(line.lstrip())
        new_lines.append(line)
        i += 1
        
        # Next should be type: 'object'
        if i < len(lines) and "type: 'object'" in lines[i]:
            new_lines.append(lines[i])
            i += 1
            
            # Next might be description
            if i < len(lines) and 'description:' in lines[i]:
                new_lines.append(lines[i])
                i += 1
            
            # Look for properties and collect required fields
            required_fields = []
            properties_start = i
            
            # Scan ahead to find required: true
            j = i
            while j < len(lines) and 'properties: {' not in lines[j]:
                j += 1
            
            if j < len(lines):
                # Found properties, now scan for required: true
                k = j + 1
                current_field = None
                while k < len(lines) and not ('},' in lines[k] and 'properties' not in lines[k+1] if k+1 < len(lines) else False):
                    if re.match(r'\s+(\w+):\s*{', lines[k]):
                        match = re.match(r'\s+(\w+):\s*{', lines[k])
                        current_field = match.group(1)
                    elif 'required: true' in lines[k] and current_field:
                        required_fields.append(current_field)
                        current_field = None
                    k += 1
            
            # Add required array if we found any
            if required_fields:
                req_line = ' ' * (indent + 6) + f"required: {required_fields},"
                new_lines.append(req_line)
            
            i = properties_start
        else:
            i += 1
    elif 'required: true,' in line:
        # Skip this line (remove required: true)
        i += 1
    else:
        new_lines.append(line)
        i += 1

# Write back
with open('infrastructure/lib/gateway-target-stack.ts', 'w') as f:
    f.write('\n'.join(new_lines))

print("Fixed required fields")
