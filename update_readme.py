import re
import pandas as pd

# Read the CSV file
df = pd.read_csv('acquisitionplan.csv')

# Convert the DataFrame to Markdown format
markdown_table = df.to_markdown(index=False)

# Read the existing README.md content
with open('README.md', 'r') as readme_file:
    readme_content = readme_file.read()

# Create a regex pattern to find the existing table
table_pattern = r'## Acquisition Plan Sentinel-2 Switzerland\n(.|\n)*?\n\n'

# Replace the existing table with the new markdown table
new_readme_content = re.sub(table_pattern, f'## Acquisition Plan Sentinel-2 Switzerland\n{markdown_table}\n\n', readme_content)

# Write the updated content back to README.md
with open('README.md', 'w') as readme_file:
    readme_file.write(new_readme_content)
