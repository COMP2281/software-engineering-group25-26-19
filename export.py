import json
import pandas as pd

def exp_excel(file_name: str):
    # Load JSON data
    try:
        with open('sample_data.json') as file:
            data = json.load(file)
    except:
        print("Error opening file.")
        return -1

    # Write data to pandas dataframe
    data = pd.json_normalize(data)
    df = pd.DataFrame.from_dict(data)

    try:
        # Export dataframe to excel
        df.to_excel('out.xlsx', index=False)
        return 0
    except:
        print("Error exporting file.")
        return -1